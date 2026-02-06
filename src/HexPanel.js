import {Data, FileObject} from "@gesslar/toolkit"
import crypto from "node:crypto"
import {clearTimeout, setTimeout} from "node:timers"
import * as vscode from "vscode"

import Validator from "./Validator.js"

// A whole bunch of things to keep code tidy
const {env, Range, Selection, TabInputText, TextEditorRevealType, Uri} = vscode
const {window, workspace, ViewColumn} = vscode

const $resources = {
  base: {
    directory: ["src", "webview"]
  },
  codicons: {
    directory: ["node_modules", "@vscode", "codicons", "dist"],
    file: ["node_modules", "@vscode", "codicons", "dist", "codicon.css"],
  }
}

export default class HexPanel {
  static viewType = "hex.panel"

  #glog
  #current
  #stateChangeListeners = []
  /** @type {FileObject} */
  #selectedFile = null
  #context = null
  #webviewView = null
  #sessionId = null
  #selectedFileWatcher = null
  #updateTimeout = null
  #schema = null
  #state = {}

  // The cache of colors objects per file
  #userColors = new Map()
  // Main cache, contains caches for each file : string fileName: Map(prop,value)
  #validations = new Map()
  // A registry of the last update time of files
  #timestamps = new Map()

  constructor(context, schema, glog) {
    this.#context = context
    this.#schema = schema
    this.#state = {}
    this.#glog = glog
  }

  async showWebview(context=this.#context) {
    if(this.#webviewView) {
      this.#webviewView.reveal()
    } else {
      await this.#createWebview(context)
    }
  }

  // Method to emit state changes
  #emitStateChange(newState) {
    try {
      this.#state = {...this.#state, ...newState}
      this.#stateChangeListeners.forEach(listener => listener(this.#state))
    } catch(error) {
      this.#glog.error(error)
    }
  }

  // Method to register state change listeners
  onStateChange(listener) {
    this.#stateChangeListeners.push(listener)
  }

  // Public methods for toolbar commands
  async selectFile(resourceUri) {
    await this.#selectFile(resourceUri)
  }

  async refresh() {
    await this.#updateData({force: true})
  }

  focusFilter() {
    if(!this.#webviewView)
      return

    this.#webviewView.webview.postMessage({
      type: "focusElement",
      element: "propertyFilter"
    })
  }

  async copyMissingProperties() {
    if(!this.#webviewView)
      return

    try {
      // Ensure schema loaded
      const schemaMap = this.#schema.map

      let userColors = {}

      if(this.#selectedFile) {
        try {
          const doc = await workspace.openTextDocument(this.#selectedFile)
          const themeData = JSON.parse(doc.getText())

          userColors = themeData?.colors ?? {}
        } catch {
          // ignore file read issues
        }
      }

      const missing = []

      for(const key of schemaMap.keys()) {
        if(!(key in userColors))
          missing.push(key)
      }

      const scaffold = missing.reduce((acc, key) => {
        const schemaProp = schemaMap.get(key) || {}

        acc[key] = schemaProp.sample || (schemaProp.alphaRequired ? "#ffffffaa" : "#ffffff")

        return acc
      }, {})

      await env.clipboard.writeText(JSON.stringify(scaffold, null, 2))
    } catch(error) {
      this.#glog.error(`Failed to copy missing properties: ${error.message}`)
    }
  }

  async #createWebview(context) {
    try {
      const localResourceRoots = Array.from(Object.values($resources))
        .map(e => this.#extPathToUri(e.directory))

      this.#webviewView = window.createWebviewPanel(
        "Hex",
        "Hex",
        ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots,
          retainContextWhenHidden: true
        }
      )

      this.#webviewView.onDidDispose(
        () => {
          this.#webviewView = null
          this.#sessionId = null

        }, null, context.subscribers
      )

      this.#webviewView.onDidChangeViewState(_ => {
        // nothing to see here
      })

      this.#webviewView.webview.html = await this.#getWebviewContent()

      // Handle messages from webview
      this.#webviewView.webview.onDidReceiveMessage(
        async message => this.#processMessage(message),
        null,
        this.#context.subscriptions
      )

      // // Restore state if available
      // webviewView.onDidChangeVisibility(async() => {
      //   try {
      //     if(webviewView.visible) {
      //       // Webview became visible, refresh data
      //       await this.#updateData()
      //       if(this.#selectedFile)
      //         this.#setupFileWatcher()
      //     } else {
      //       if(this.#selectedFileWatcher) {
      //         this.#selectedFileWatcher.dispose()
      //         this.#selectedFileWatcher = null
      //       }
      //     }
      // } catch(error) {
      // this.#glog.error(error)
      //   }
      // })

      // Initial data load
      // await this.#updateData()
    } catch(error) {
      this.#glog.error(error)
    }
  }

  async #selectFile(resourceUri=null) {
    try {
      if(!resourceUri) {
        const fileUri = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            "VS Code Theme": ["color-theme.json"]
          },
          defaultUri: workspace.workspaceFolders?.[0]?.uri
        })

        if(fileUri?.[0]) {
          resourceUri = fileUri[0]
        }
      }

      if(resourceUri) {
        // Clean up previous file watcher
        if(this.#selectedFileWatcher) {
          this.#selectedFileWatcher.dispose()
          this.#selectedFileWatcher = null
        }

        const file = new FileObject(resourceUri.path)
        this.#selectedFile = file

        // Show the webview!
        await this.showWebview()
        // Do the thing
        await this.#updateData()
        this.#setupFileWatcher()
        this.#emitStateChange({selectedFile: this.#selectedFile})
      }
    } catch(error) {
      console.error("Nope", error)
      // throw error
    }
  }

  #setupFileWatcher() {
    if(!this.#selectedFile)
      return

    // Clean up previous watcher
    if(this.#selectedFileWatcher) {
      this.#selectedFileWatcher.dispose()
      this.#selectedFileWatcher = null
    }

    try {
      this.#selectedFileWatcher = workspace.createFileSystemWatcher(
        this.#selectedFile.path,
        true,  // ignore create
        false, // watch change
        false  // watch delete
      )

      this.#selectedFileWatcher.onDidChange(() =>
        this.#debouncedUpdateData({force: true})
      )

      this.#selectedFileWatcher.onDidDelete(async() => {
        this.#selectedFile = null
        this.#context.workspaceState.update("hex.selectedFile", undefined)

        await this.#updateData({force: true})
      })
    } catch(error) {
      console.error("Failed to create file watcher:", error)
    }
  }

  #debouncedUpdateData({force=false}) {
    // Clear existing timeout
    if(this.#updateTimeout)
      clearTimeout(this.#updateTimeout)

    // Set new timeout to debounce rapid file changes
    this.#updateTimeout = setTimeout(async() => {
      await this.#updateData({force})
      this.#updateTimeout = null
    }, 150)
  }

  async #updateData({force = false} = {}) {
    if(!this.#webviewView)
      return

    try {
      if(this.#selectedFile) {
        const cacheKey = this.#selectedFile.path

        try {
          // Load theme content
          await this.#loadThemeContent(force)

          // Validate only the colors against workbench schema (memory cache,
          // force bypass)
          try {
            if(force)
              this.#clearValidations(cacheKey)

            if(!this.#validations.has(cacheKey)) {
              const content = this.#userColors.get(cacheKey)

              if(!content)
                return

              await this.#validate(cacheKey)
            }
          } catch(error) {
            console.error("Validation cache error", error)
          }
        } catch(error) {
          console.error("Error processing selected file:", error)
        }

        const userColorsForFile =
          this.#userColors.get(this.#selectedFile.path) || {}

        const selectedFileInfo = {
          path: workspace.asRelativePath(this.#selectedFile.path),
          propertyCount: Object.keys(userColorsForFile).length,
          schemaSize: this.#schema.size,
          timestamp: this.#timestamps.get(this.#selectedFile.path)
        }

        this.#current = {
          type: "validationResults",
          selectedFile: selectedFileInfo,
          validationResults: this.#validations.get(this.#selectedFile.path)
        }

        // Send data to webview
        this.#webviewView.webview.postMessage(this.#current)
      }
    } catch(error) {
      this.#webviewView.webview.postMessage({
        type: "error",
        message: error.message
      })
    }
  }

  #extPathToUri(parts) {
    return Uri.joinPath(this.#context.extensionUri, ...parts)
  }

  #extPathToWebviewUri(parts) {
    if(!this.#webviewView?.webview)
      throw new Error("No such thing as a webview.")

    return this.#webviewView.webview.asWebviewUri(this.#extPathToUri(parts))
  }

  /**
   * Loads and returns the HTML content for the webview panel, replacing
   * placeholders with actual URIs.
   *
   * @param {vscode.WebviewPanel} webview - The webview
   * @returns {Promise<string>} The loaded HTML
   */
  async #getWebviewContent() {
    try {
      const webview = this.#webviewView.webview
      const {base, codicons} = $resources

      // Now setup the base
      const baseDir = this.#extPathToWebviewUri(base.directory)
      const codiFile = this.#extPathToWebviewUri(codicons.file)

      // Get the html
      const thisFile = new FileObject(import.meta.filename)
      const htmlFile = thisFile.parent.getFile("webview/webview.html")
      const html = await htmlFile.read()

      // Replace placeholders in the html file
      const subbed = html
        .replace(/\{\{BASE_URI\}\}/g, Data.append(baseDir.toString(), "/"))
        .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
        .replace(/\{\{CODICON_CSS\}\}/g, codiFile.toString())

      // yeet
      return subbed
    } catch(error) {
      this.#glog.error(error.stack)

      return "<div class=\"error\">Error loading webview content: " + error.message + "</div>"
    }
  }

  #clearValidations(key) {
    if(!this.#validations.has(key))
      return false

    this.#validations.delete(key)

    return true
  }

  #setValidations(key, validations) {
    this.#validations.set(key, validations)
  }

  #escapeRegexString(string) {
    return string
      .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
  }

  async #jumpToProperty({property}) {
    // this.#glog.info(`Jumping to property '${property}' in '${this.#selectedFile?.path}'`)

    if(!property || !this.#selectedFile)
      return

    try {
      const uri = Uri.parse(this.#selectedFile.url)
      // this.#glog.info("uri = %o", uri)

      // openTextDocument returns existing doc if already open, doesn't duplicate
      const doc = await workspace.openTextDocument(uri)

      // Find existing tab for this document across all tab groups
      const existingTab = window.tabGroups.all
        .flatMap(group => group.tabs.map(tab => ({tab, group})))
        .find(({tab}) =>
          tab.input instanceof TabInputText &&
          tab.input.uri.toString() === uri.toString()
        )

      const viewColumn = existingTab?.group.viewColumn ?? ViewColumn.Beside

      const text = doc.getText()
      const escaped = this.#escapeRegexString(property)
      const pattern = new RegExp(`"${escaped}"\\s*:`, "g")
      const match = pattern.exec(text)

      if(match) {
        // inside opening quote
        const pos = doc.positionAt(match.index + 1)
        const editor = await window.showTextDocument(doc, {
          viewColumn, preview: false
        })

        editor.revealRange(
          new Range(pos, pos),
          TextEditorRevealType.InCenterIfOutsideViewport
        )

        editor.selection = new Selection(
          pos,
          pos.translate(0, property.length)
        )
      } else {
        this.#processMessage(
          "showError",
          `'${property}' not found in file ${this.#selectedFile}`
        )
      }
    } catch(error) {
      window.showErrorMessage(error.message, 3_000)
      // Ignore reveal errors
    }
  }

  async #loadThemeContent(force=false) {
    // this.#glog.info("loadThemeContent")

    try {
      // Is file there and also accessible?
      if(!(await this.#selectedFile.exists))
        return

      const lastChanged = await this.#selectedFile.modified()
      const path = this.#selectedFile.path

      if(!force &&
          this.#timestamps.has(path) &&
          this.#userColors.has(path)) {

        if(this.#timestamps.get(path) === lastChanged)
          return this.#userColors.get(path)
      }

      const fileContent = await this.#selectedFile.loadData()

      if(!fileContent)
        throw new Error("No content loaded")

      if(!Object.prototype.hasOwnProperty.call(fileContent, "colors"))
        throw new Error("No 'colors' object in theme file.")

      this.#userColors.set(this.#selectedFile.path, fileContent.colors)
      this.#timestamps.set(this.#selectedFile.path, lastChanged)
    } catch(error) {
      console.error(`Unable to load ${this.#selectedFile.path}`, error)
    }
  }

  async #validate(fileName) {
    const userColors = this.#userColors.get(fileName)

    if(!userColors)
      return

    const result = await Validator.validate(
      this.#schema.map ?? new Map(), userColors
    )

    this.#setValidations(fileName, result)
  }

  async #processMessage(message) {
    // this.#glog.info(`Received message: %o`, message)

    switch(message.type) {
      case "showError":
        message.message
        &&
        window.showErrorMessage(message.message, 3_000)
        break
      case "jumpToProperty":
        message.property && await this.#jumpToProperty(message)
        break
      case "requestData":
        await this.#updateData()
        break
      case "log":
        this.#glog.info(`[webview]: ${message.msg}`)
        break
      case "ready":
        try {
          this.#sessionId ??= crypto.randomUUID().slice(0, 8)
          this.#webviewView.webview.postMessage(
            {
              type: "setSessionId",
              sessionId: this.#sessionId
            }
          )
        } catch(error) {
          this.#glog.error(error)
        } finally {
          break
        }
    }
  }

  dispose() {
    if(this.#selectedFileWatcher)
      this.#selectedFileWatcher.dispose()
  }
}
