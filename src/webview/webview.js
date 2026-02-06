const vscode = acquireVsCodeApi()

import {DisposerClass, HTML, Notify, NotifyClass, Promised} from "./vendor/toolkit-3.31.0.js"
const {setState, getState} = vscode

// eslint-disable-next-line no-unused-vars
const testOk = "badge.foreground", testErr = "window.activeBorder"

/** @import {ValidationResult} from "../VSCodeSchema.js" */

const ErrorsOnly = Object.freeze({
  TRUE: "Show Me Only The Errors",
  FALSE: "Nah Fam Show Me Everything",
})

const UseRegex = Object.freeze({
  TRUE: "Regex Up In Here",
  FALSE: "Nah, It's all Loosey Goosey"
})

const MatchCase = Object.freeze({
  TRUE: "Bananas in Pajamas",
  FALSE: "Are Walking Down The Stairs"
})

class WebHex {
  #lastValidationResults = null
  #validationElements = new Map()
  #disposer
  #notify
  #elements = {}
  #elementIds = [
    "coveragePercent",
    "errorText",
    "filePath",
    "propertyCount",
    "propertyFilter",
    "totalProperties",
    "validation-item-template",
    "validationResults",
  ]
  #filterRegex

  #clickFunction = evt => this.#validationElementClick(evt)
  #log = msg => vscode.postMessage({type: "log", msg})

  constructor() {
    this.#disposer = new DisposerClass()
    this.#notify = new NotifyClass()

    this.#elementIds.forEach(e => {
      const element = document.getElementById(e)
      if(!element)
        throw new Error(`Missing '${e}'`)

      this.#elements[e] = element
    })

    // But, we need a disposer for the clicking so we can free them up, whenever
    // we do the thing.
    this.#disposer.register(
      this.#notify.on("click", evt => this.#validationElementClick(evt), document)
    )

    // Global notify!
    Notify.on("message", evt => this.#onMessage(evt))
    Notify.on("data:received", evt => this.#processIncomingData(evt))
    Notify.on("error:received", evt => this.#processIncomingError(evt))
    Notify.on("find-input", evt => this.#onFilterChange(evt), this.#elements.propertyFilter)

    vscode.postMessage({type: "ready"})
  }

  #restoreSession(state) {
    const {errorsOnly = ErrorsOnly.FALSE, filterText = ""} = state

    const propertyFilter = this.#elements.propertyFilter
    propertyFilter.value = filterText
    propertyFilter.errorsOnly = errorsOnly === ErrorsOnly.TRUE

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

  #processIncomingError(evt) {
    console.error(evt)
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

  /**
   * Set an error message or clear it.
   *
   * @param {string|null} message - The message to display. Null to clear.
   */
  #setError(message) {
    const errorText = this.#elements.errorText

    if(!errorText)
      return

    if(message === null) {
      errorText.innerHTML = ""
      errorText.classList.toggle("noError")

      return
    }

    if(!message)
      return

    errorText.innerHTML = message
    errorText.classList.toggle("noError")
  }

  /**
   * Handle filter changes from the FindWidget component.
   *
   * @param {CustomEvent} evt - The find-input event
   */
  #onFilterChange(evt) {
    const {
      value: filterText,
      errorsOnly,
      useRegex,
      matchCase
    } = evt.detail ?? {}

    this.#save({
      filterText,
      errorsOnly: errorsOnly ? ErrorsOnly.TRUE : ErrorsOnly.FALSE,
      useRegex: useRegex ? UseRegex.TRUE : UseRegex.FALSE,
      matchCase: matchCase ? MatchCase.TRUE : MatchCase.FALSE,
    })

    if(filterText) {
      if(useRegex === UseRegex.TRUE) {
        if(matchCase === MatchCase.TRUE) {
          this.#filterRegex = new RegExp(filterText)
        } else {
          this.#filterRegex = new RegExp(filterText, "i")
        }
      } else {
        this.#filterRegex = undefined
      }
    }

    this.#applyFilter()
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
      errorsOnly = ErrorsOnly.FALSE,
      filterText = "",
      useRegex = UseRegex.FALSE,
      matchCase = MatchCase.FALSE,
    } = getState() ?? {}

    if(errorsOnly === ErrorsOnly.TRUE && item.status !== "invalid")
      return false

    if(filterText) {
      if(useRegex == UseRegex.TRUE) {
        return this.#filterRegex.test(item.property)
      } else {
        if(matchCase === MatchCase.TRUE) {
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
      this.#setError(selectedFile.error)

      return
    }

    this.#elements.filePath.innerText = selectedFile.path
    this.#elements.propertyCount.innerText = selectedFile.propertyCount || "No"
    this.#elements.coveragePercent.innerText = (
      (selectedFile.propertyCount/selectedFile.schemaSize)*100.0).toFixed(0) || "0"
    this.#elements.totalProperties.innerText = selectedFile.schemaSize || "an unknown number of"
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

      // Update error count on the FindWidget
      this.#elements.propertyFilter.errorCount = invalidItems.length

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

        /** @type {HTMLDivElement} */
        const propEl = entryElement.querySelector(".validation-property")
        propEl.textContent = entry.property
        propEl.title = "Click to copy property name"

        /** @type {HTMLDivElement} */
        const schemaDescEl = entryElement.querySelector(".schema-description")
        schemaDescEl.textContent = entry.schemaDescription ?? ""

        /** @type {HTMLDivElement} */
        const valueEl = entryElement.querySelector(".validation-value")
        valueEl.textContent = entry.value
        valueEl.classList.add(entry.status)

        /** @type {HTMLDivElement} */
        const descEl = entryElement.querySelector(".validation-description")
        descEl.textContent = entry.description
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

Notify.on("DOMContentLoaded", () => new WebHex())
