const vscode = acquireVsCodeApi()

import {DisposerClass, HTML, Notify, NotifyClass, Promised, Util} from "./vendor/toolkit-3.31.0.js"
const {setState, getState} = vscode

// eslint-disable-next-line no-unused-vars
const testOk = "badge.foreground", testErr = "window.activeBorder"

/** @import {ValidationResult} from "../VSCodeSchema.js" */

class WebHex {
  #lastValidationResults = null
  #validationElements = new Map()
  #disposer
  #notify
  #elements = {}
  #filterRegex

  #clickFunction = evt => this.#validationElementClick(evt)
  #log = msg => vscode.postMessage({type: "log", msg})

  constructor() {
    this.#disposer = new DisposerClass()
    this.#notify = new NotifyClass()

    // Find everything that has an id and register it for easy use!
    document.querySelectorAll("*[id]")
      .forEach(e => {
        e.dataset.elementName = toCamelCase(e.id)
        this.#elements[e.dataset.elementName] = e
      })

    // But, we need a disposer for the clicking so we can free them up, whenever
    // we do the thing.
    this.#disposer.register(
      this.#notify.on("click", evt => this.#validationElementClick(evt), document)
    )

    // Global notify!
    Notify.on("message", evt => this.#onMessage(evt))
    Notify.on("data:received", evt => this.#processIncomingData(evt))

    // Buttonbar
    Notify.on("click", evt => this.#handleButtonBarClick(evt), this.#elements.exportProblems)
    Notify.on("click", evt => this.#handleButtonBarClick(evt), this.#elements.exportMissing)
    Notify.on("click", evt => this.#handleButtonBarClick(evt), this.#elements.snake)

    // Filter bar
    Notify.on("input", evt => this.#handleFilterChange(evt), this.#elements.filterText)
    Notify.on("click", evt => this.#handleClearAllClick(evt), this.#elements.clearAll)
    Notify.on("click", evt => this.#handleFilterCriterionClick(evt), this.#elements.matchCase)
    Notify.on("click", evt => this.#handleFilterCriterionClick(evt), this.#elements.useRegex)
    Notify.on("click", evt => this.#handleFilterCriterionClick(evt), this.#elements.errorsOnly)
    Notify.on("click", evt => this.#handleFilterCriterionClick(evt), this.#elements.warningsOnly)

    // Wunderbar
    this.#setHasFile(false)

    vscode.postMessage({type: "ready"})
  }

  #restoreSession(state) {
    const {
      errorsOnly = "",
      warningsOnly = "",
      filterText = "",
      useRegex = "",
      matchCase = "",
    } = state

    this.#elements.filterText.value = filterText
    this.#elements.errorsOnly.dataset.active = errorsOnly
    errorsOnly && this.#elements.errorsOnly.classList.toggle("active")
    this.#elements.warningsOnly.dataset.active = warningsOnly
    warningsOnly && this.#elements.warningsOnly.classList.toggle("active")
    this.#elements.useRegex.dataset.active = useRegex
    useRegex && this.#elements.useRegex.classList.toggle("active")
    this.#elements.matchCase.dataset.active = matchCase
    matchCase && this.#elements.matchCase.classList.toggle("active")

    const {selectedFile, validationResults} = state

    if(selectedFile && validationResults) {
      const message = {detail: {selectedFile, validationResults}}

      this.#processIncomingData(message)
    }
  }

  #save(ob) {
    setState({...getState(), ...ob})
  }

  #onMessage(event) {
    try {
      const message = event.data

      switch(message.type) {
        case "validationResults":
          this.#notify.emit("data:received", message)
          break
        case "error":
          this.#notify.emit("error:received", message)
          break
        case "setSessionId":
          const previousState = getState() ?? {}
          const {sessionId: previousSessionId} = previousState
          const {sessionId} = message

          if(sessionId === previousSessionId) {
            this.#restoreSession(previousState)
          } else {
            this.#setHasFile(false)
            setState({sessionId})
            vscode.postMessage({type: "requestData"})
          }

          break
      }
    } catch(error) {
      this.#log(error.message)
      console.error(error)
    }
  }

  #processIncomingData({detail}) {
    this.#save(detail)
    this.#updateStatistics(detail.selectedFile)
    this.#updateValidationDisplay(detail.validationResults)
  }

  /**
   * Set UI to show either the selected file view or the no-file placeholder.
   *
   * @param {boolean} hasFile - true if a file is currently selected
   */
  #setHasFile(hasFile=false) {
    // Hide all no-file elements when we have a file
    document.querySelectorAll("[no-file]").forEach(el =>
      el.toggleAttribute("hidden", hasFile)
    )

    // Hide all file elements when we don't have a file
    document.querySelectorAll("[file]").forEach(el =>
      el.toggleAttribute("hidden", !hasFile)
    )
  }

  #updateErrors(items) {
    const text = this.#elements.errorCount
    const button = this.#elements.errorsOnly
    const num = items.length

    text.textContent = num
    button.classList.toggle("has-errors", num > 0)
    button.title = `${num} ${num === 1 ? "error" : "errors"} - click to filter`
  }

  #updateWarnings(items) {
    const text = this.#elements.warningCount
    const button = this.#elements.warningsOnly
    const num = items.length

    text.textContent = num
    button.classList.toggle("has-warnings", num > 0)
    button.title = `${num} ${num === 1 ? "warning" : "warnings"} - click to filter`
  }

  /**
   * Handle filter changes from the FindWidget component.
   *
   * @param {CustomEvent} evt - The find-input event
   */
  #handleFilterChange(_evt) {
    const filterText = this.#elements.filterText.value

    this.#save({filterText})

    const {
      filterText: value,
      useRegex,
      matchCase
    } = getState() ?? {}

    if(value) {
      if(useRegex) {
        try {
          if(matchCase) {
            this.#filterRegex = new RegExp(filterText)
          } else {
            this.#filterRegex = new RegExp(filterText, "i")
          }
        } catch {
          // simply won't match
        }
      } else {
        this.#filterRegex = undefined
      }
    }

    this.#applyFilter()
  }

  #handleClearAllClick(_evt) {
    this.#elements.filterText.value = ""
    this.#handleFilterChange()
  }

  #handleButtonBarClick(evt) {
    const element = evt.currentTarget

    switch(element.id) {
      case "snake": {
        vscode.postMessage({type: "showInfo", message: "Snake."})
        break
      }

      case "export-problems": {
        vscode.postMessage({type: "exportProblems"})
        break
      }

      case "export-missing": {
        vscode.postMessage({type: "exportMissing"})
        break
      }
    }
  }

  #handleFilterCriterionClick(evt) {
    const element = evt.currentTarget
    const elementName = element.dataset.elementName
    const newValue = element.dataset.active === elementName
      ? ""
      : elementName

    element.dataset.active = newValue
    element.classList.toggle("active")

    this.#save({[elementName]: newValue})
    this.#handleFilterChange()
  }

  async #applyFilter() {
    const validationElements = Array.from(this.#validationElements.values())

    Promised.settle(validationElements.map(async([entry, element]) => {
      try {
        const allowedToShow = this.#allowShow(entry)

        if(allowedToShow)
          element.classList.remove("hidden")
        else
          element.classList.add("hidden")

        entry.property === testOk && console.log(element)
      } catch(error) {
        console.error(error)
      }
    }))
  }

  #allowShow(item) {
    const {
      warningsOnly = "",
      errorsOnly = "",
      filterText = "",
      useRegex = "",
      matchCase = "",
    } = getState() ?? {}

    if(errorsOnly || warningsOnly) {
      if(errorsOnly && warningsOnly) {
        if(item.status !== "invalid" && item.status !== "warn") {
          return false
        }
      } else if(errorsOnly && item.status !== "invalid") {
        return false
      } else if(warningsOnly && item.status !== "warn") {
        return false
      }
    }

    if(filterText) {
      if(useRegex) {
        return this.#filterRegex.test(item.property)
      } else {
        if(matchCase) {
          return item.property.includes(filterText)
        } else {
          return item.property.toLowerCase().includes(filterText.toLowerCase())
        }
      }
    }

    return true
  }

  /**
   * A file has been selected, now we need to do the magic! *glitter bae*
   *
   * @param {object} message - The file information passed from the back end.
   */
  #updateStatistics(selectedFile) {
    if(!selectedFile)
      return

    if(selectedFile.error) {
      vscode.postMessage({type: "showError", message: selectedFile.error})

      return
    }

    const total = selectedFile.schemaSize || "???"
    const properties = selectedFile.propertyCount || "0"
    const coverage = selectedFile.schemaSize && selectedFile.propertyCount
      ? (properties / total * 100.0).toFixed(0)
      : "unknown"

    this.#elements.properties.innerText = `${properties}/${total} properties`
    this.#elements.coverage.innerText = `${coverage}% coverage`
  }

  /**
   * Updates the validationResults element with the data from the back end.
   *
   * @param {Array<ValidationResult>} validationResults - The validation information from the back end.
   */
  #updateValidationDisplay(validationResults) {
    try {
      const hasFile = validationResults && validationResults.length > 0

      this.#setHasFile(hasFile)

      if(!hasFile)
        return

      const container = this.#elements.validationResults

      const invalidItems = validationResults.filter(r => r.status === "invalid")
      this.#updateErrors(invalidItems)

      const warningItems = validationResults.filter(r => r.status === "warn")
      this.#updateWarnings(warningItems)

      // Refreshing! Mwah!
      this.#disposer.dispose()
      this.#validationElements.clear()
      HTML.clearHTMLContent(container)

      const template = document.getElementById("validation-item-template")

      Promised.settle(validationResults.map(async entry => {
        /** @type {HTMLDivElement} */
        const clone = template.content.cloneNode(true)
        /** @type {HTMLElement} */
        const entryElement = clone.querySelector(".validation-item")

        if(!entryElement)
          return

        entryElement.dataset.prop = entry.property

        if(entry.status === "invalid")
          entryElement.classList.add("invalid")

        if(entry.status === "warn")
          entryElement.classList.add("warn")

        /** @type {HTMLDivElement} */
        const propEl = entryElement.querySelector(".validation-property")
        propEl.textContent = entry.property
        propEl.title = "Click to copy property name"

        /** @type {HTMLDivElement} */
        const schemaDescEl = entryElement.querySelector(".schema-description")
        schemaDescEl.textContent = entry.description ?? ""

        /** @type {HTMLDivElement} */
        const valueEl = entryElement.querySelector(".validation-value")
        valueEl.textContent = entry.value
        valueEl.classList.add(entry.status)

        /** @type {HTMLDivElement} */
        const descEl = entryElement.querySelector(".validation-description")
        descEl.textContent = entry.message ?? ""
        descEl.classList.add(entry.status)

        this.#disposer.register(this.#notify.on("click", this.#clickFunction, entryElement))

        this.#validationElements.set(entry.property, [entry, entryElement])

        const allowedToShow = this.#allowShow(entry)

        if(!allowedToShow)
          entryElement.classList.add("hidden")

        container.appendChild(entryElement)
      }))
    } catch(error) {
      console.error(error)
    }
  }

  // Delegate click events for property copy
  #validationElementClick(evt) {
    const el = evt.target.closest(".validation-item")

    if(!el)
      return

    const propName = el.dataset.prop

    if(!propName)
      return

    if(vscode) {
      try {
        vscode.postMessage({type: "jumpToProperty", property: propName})
      } catch {
      // ignore error
      }
    }
  }
}

function toCamelCase(string) {
  if(/[-_ #$]/.test(string))
    return string
      .split(/[-_ #$]/)
      .map(a => a.trim())
      .filter(Boolean)
      .map(a => a
        .split("")
        .filter(b => /[\w]/.test(b))
        .filter(Boolean)
        .join("")
      )
      .map(a => a.toLowerCase())
      .map((a, i) => i === 0 ? a : Util.capitalize(a))
      .join("")

  return string
}

Notify.on("DOMContentLoaded", () => new WebHex())
