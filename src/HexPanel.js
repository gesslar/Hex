import * as vscode from "vscode"
import path from "node:path"
import fs from "node:fs/promises"
import {fileURLToPath} from "node:url"
import {setTimeout, clearTimeout} from "node:timers"
import console from "node:console"
import JSON5 from "json5"

import Validator from "./Validator.js"

export default class HexPanel {
  static viewType = "hex.panel"

  #state = null
  #stateChangeListeners = []
  #selectedFile = null
  #context = null
  #webviewView = null
  #selectedFileWatcher = null
  #updateTimeout = null
  #schema = null

  // The cache of colors objects per file
  #userColors = new Map()
  // Main cache, contains caches for each file : string fileName: Map(prop,value)
  #validations = new Map()
  // A registry of the last update time of files
  #timestamps = new Map()

  constructor(context, schema, state={}) {
    this.#context = context
    this.#state = state
    this.#schema = schema
  }

  // Method to emit state changes
  #emitStateChange(newState) {
    try {
      this.#state = {...this.#state, ...newState}
      this.#stateChangeListeners.forEach(listener => listener(this.#state))
    } catch(error) {
      console.error(error)
    }
  }

  // Method to register state change listeners
  onStateChange(listener) {
    this.#stateChangeListeners.push(listener)
  }

  // Public methods for toolbar commands
  async selectFile() {
    await this.#selectFile()
  }

  async refresh() {
    await this.#updateData({force: true})
  }

  focusFilter() {
    if(!this.#webviewView)
      return

    this.#webviewView.webview.postMessage({type: "focusFilter"})
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
          const doc =
            await vscode.workspace.openTextDocument(this.#selectedFile)
          const themeData = JSON.parse(doc.getText())

          userColors = themeData?.colors ?? {}
        } catch(_) {
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

      await vscode.env.clipboard.writeText(JSON.stringify(scaffold, null, 2))
      vscode.window.showInformationMessage(`Copied ${missing.length} missing properties to clipboard`)
    } catch(error) {
      vscode.window.showErrorMessage(`Failed to copy missing properties: ${error.message}`)
    }
  }

  async resolveWebviewView(webviewView) {
    try {
      this.#webviewView = webviewView

      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [this.#context.extensionUri],
        retainContextWhenHidden: true
      }

      webviewView.webview.html =
        await this.#getWebviewContent(webviewView.webview)

      // Handle messages from webview
      webviewView.webview.onDidReceiveMessage(
        async message => this.#processMessage(message),
        null,
        this.#context.subscriptions
      )

      // Restore state if available
      webviewView.onDidChangeVisibility(async() => {
        try {
          if(webviewView.visible) {
            // Webview became visible, refresh data
            await this.#updateData()
            if(this.#selectedFile)
              this.#setupFileWatcher()
          } else {
            if(this.#selectedFileWatcher) {
              this.#selectedFileWatcher.dispose()
              this.#selectedFileWatcher = null
            }
          }
        } catch(error) {
          console.error(error)
        }
      })

      // Initial data load
      await this.#updateData()
    } catch(error) {
      console.error(error)
      throw error
    }
  }

  async #selectFile() {
    try {
      const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          "VS Code Theme": ["color-theme.json"]
        },
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
      })

      if(fileUri?.[0]) {
      // Clean up previous file watcher
        if(this.#selectedFileWatcher) {
          this.#selectedFileWatcher.dispose()
          this.#selectedFileWatcher = null
        }

        this.#selectedFile = fileUri[0]

        // Save selected file to workspace state
        this.#context.workspaceState.update("hex.selectedFile", this.#selectedFile)

        await this.#updateData()

        this.#setupFileWatcher()
        this.#emitStateChange({selectedFile: this.#selectedFile})
      }
    } catch(error) {
      console.error(error)
      throw error
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
      // Original WIP debug message restored
      const fileDir = path.dirname(this.#selectedFile.fsPath)
      const fileBase = path.basename(this.#selectedFile.fsPath)
      const pattern = new vscode.RelativePattern(fileDir, fileBase)

      this.#selectedFileWatcher = vscode.workspace.createFileSystemWatcher(
        pattern,
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

    // Cache key is just the file name.
    const cacheKey = this.#selectedFile?.fsPath

    try {
      if(cacheKey) {
        try {
          // Load theme content
          await this.#loadThemeContent(cacheKey, force)

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
          this.#userColors.get(this.#selectedFile.fsPath) || {}
        const selectedFileInfo = {
          path: vscode.workspace.asRelativePath(this.#selectedFile),
          propertyCount: Object.keys(userColorsForFile).length,
          schemaSize: this.#schema.size,
          timestamp: this.#timestamps.get(this.#selectedFile.fsPath)
        }

        // Send data to webview
        const postPayload = {
          type: "dataUpdated",
          selectedFile: selectedFileInfo,
          validationResults: this.#validations.get(this.#selectedFile.fsPath)
        }

        this.#webviewView.webview.postMessage(postPayload)
      }
    } catch(error) {
      this.#webviewView.webview.postMessage({
        type: "error",
        message: error.message
      })
    }
  }

  async #getWebviewContent(webview) {
    try {
      const cwf = fileURLToPath(import.meta.url)
      const cwd = path.dirname(cwf)

      // Get webview URI for CSS file
      const cssPath = vscode.Uri.file(path.join(cwd, "webview", "webview.css"))
      const cssUri = webview.asWebviewUri(cssPath)

      // Get webview URI for CodeIcons file
      const codeIconPath = vscode.Uri.joinPath(
        this.#context.extensionUri,
        "node_modules", "@vscode", "codicons", "dist", "codicon.css"
      )
      const codeIconUri = webview.asWebviewUri(codeIconPath)

      // Get webview URI for @vscode-elements
      const vscodeElementsPath = vscode.Uri.joinPath(
        this.#context.extensionUri,
        "node_modules", "@vscode-elements", "elements", "dist", "bundled.js"
      )
      const vscodeElementsUri = webview.asWebviewUri(vscodeElementsPath)

      // Get webview URI for @vscode-elements
      const webviewScriptPath = vscode.Uri.file(path.join(cwd, "webview", "webview.js"))
      const webviewScriptUri = webview.asWebviewUri(webviewScriptPath)

      const htmlPath = path.join(cwd, "webview", "webview.html")
      let html = await fs.readFile(htmlPath, "utf8")

      // Replace placeholders
      html = html.replace(/\{\{CSS_URI\}\}/g, cssUri.toString())
      html = html.replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
      html = html.replace(/\{\{VSCODE_ELEMENTS_URI\}\}/g, vscodeElementsUri.toString())
      html = html.replace(/\{\{SCRIPT_URI\}\}/g, webviewScriptUri.toString())
      html = html.replace(/\{\{CODEICON_URI\}\}/g, codeIconUri.toString())

      return html
    } catch(error) {
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
    if(!property || !this.#selectFile)
      return

    try {
      // Attempt to locate the property in the currently selected file and
      // reveal
      try {
        const doc = await vscode.workspace.openTextDocument(this.#selectedFile)
        const text = doc.getText()
        const escaped = this.#escapeRegexString(property)
        const pattern = new RegExp(`"${escaped}"\\s*:`, "g")
        const match = pattern.exec(text)

        if(match) {
          // inside opening quote
          const pos = doc.positionAt(match.index + 1)
          const editor =
            await vscode.window.showTextDocument(doc, {preview: false})

          editor.revealRange(
            new vscode.Range(pos, pos),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
          )

          editor.selection = new vscode.Selection(
            pos,
            pos.translate(0, property.length)
          )
        } else {
          this.#showError(`'${property}' not found in file ${this.#selectedFile}`,
            3000
          )
        }
      } catch {
        // Ignore reveal errors
      }
    } catch(err) {
      vscode.window.showErrorMessage(
        `Failed to copy property: ${err.message}`
      )
    }
  }

  async #loadThemeContent(fileName, force=false) {
    try {
      // Is file there and also accessible?
      await fs.access(fileName, fs.constants.R_OK)

      const stats = await fs.lstat(fileName)
      const lastChanged = stats.mtime

      if(!force &&
          this.#timestamps.has(fileName) &&
          this.#userColors.has(fileName)) {

        if(this.#timestamps.get(fileName) === lastChanged)
          return this.#userColors.get(fileName)
      }

      const fileContent = await fs.readFile(fileName, "utf-8")

      if(!fileContent)
        throw new Error("No content loaded")

      const parsed = JSON5.parse(fileContent)

      if(!Object.prototype.hasOwnProperty.call(parsed, "colors"))
        throw new Error("No 'colors' object in theme file.")

      this.#userColors.set(fileName, parsed.colors)
      this.#timestamps.set(fileName, lastChanged)
    } catch(error) {
      console.error(`Unable to load ${fileName}`, error)
    }
  }

  async #validate(fileName) {
    const userColors = this.#userColors.get(fileName)

    if(!userColors)
      return

    const result = await Validator.validate(this.#schema.map, userColors)

    this.#setValidations(fileName, result)
  }

  #showError({message}) {
    vscode.window.showErrorMessage(message)
  }

  async #processMessage(message) {
    switch(message.type) {
      case "showError":
        message.message && this.#showError(message)
        break
      case "jumpToProperty":
        message.property && await this.#jumpToProperty(message)
        break
    }
  }

  dispose() {
    this.#context.subscriptions.forEach(d => d.dispose())

    if(this.#selectedFileWatcher)
      this.#selectedFileWatcher.dispose()
  }
}
