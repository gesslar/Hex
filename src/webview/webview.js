// Acquire VS Code API exactly once (avoid repeated acquisition errors)
const vscode = acquireVsCodeApi()

document.addEventListener("DOMContentLoaded", event => main(event))

/**
 * Main entry point.
 *
 * @param {event} _event - The event of this document having loaded.
 */
function main(_event) {
  let lastValidationResults = null
  let suppressAnimation = false
  let autoExpanding = false

  setHasFile(false)

  window.addEventListener("message", event => {
    try {
      const message = event.data

      switch(message.type) {
        case "dataUpdated":
          updateSelectedFile(message.selectedFile)
          updateValidationResults(message.validationResults)
          break
        case "error":
          console.error(message)
          break
        case "focusFilter":
          {
            const input = document.getElementById("propertyFilter")

            if(input) {
              input.focus()
              input.select()
            }
          }
          break
      }
    } catch(error) {
      console.error(error)
    }
  })

  /**
   * Set an error message or clear it.
   *
   * @param {string|null} message - The message to display. Null to clear.
   */
  function setError(message) {
    const errorText = document.getElementById("errorText")

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
   * Re-render the existing validation results with current data but new filter
   *
   */
  function toggleErrorsOnly() {
    suppressAnimation = true
    updateValidationResults(lastValidationResults)
    suppressAnimation = false
  }

  window.toggleErrorsOnly = toggleErrorsOnly

  /**
   * Re-render with current data but new filter
   */
  function filterByProperty() {
    suppressAnimation = true
    updateValidationResults(lastValidationResults)
    suppressAnimation = false
  }
  window.filterByProperty = filterByProperty

  /**
   * A file has been selected, now we need to do the magic! *glitter bae*
   *
   * @param {object} selectedFile - The file information passed from the back end.
   */
  function updateSelectedFile(selectedFile) {
    if(!selectedFile)
      return

    if(selectedFile.error) {
      setError(selectedFile.error)

      return
    }

    setHasFile(true)

    const filePathElement = document.getElementById("filePath")

    if(filePathElement)
      filePathElement.innerText = selectedFile.path

    const propertyCountElement = document.getElementById("propertyCount")

    if(propertyCountElement)
      propertyCountElement.innerText = selectedFile.propertyCount || "No"

    const coveragePercentElement = document.getElementById("coveragePercent")

    if(coveragePercentElement)
      coveragePercentElement.innerText = (
        (selectedFile.propertyCount/selectedFile.schemaSize)*100.0).toFixed(0) || "0"

    const totalPropertiesElement = document.getElementById("totalProperties")

    if(totalPropertiesElement)
      totalPropertiesElement.innerText = selectedFile.schemaSize || "an unknown number of"

    try {
      const validationResultsElement = document.getElementById("validationResults")

      if(!validationResultsElement)
        throw new Error("Missing 'validationResults'")

      setHasFile(true)
    } catch(e) {
      console.error(e)
    }
  }

  /**
   * Set UI to show either the selected file view or the no-file placeholder.
   *
   * @param {boolean} hasFile - true if a file is currently selected
   */
  function setHasFile(hasFile) {
  // Hide all no-file elements when we have a file
    document.querySelectorAll("[no-file]").forEach(el => {
      el.toggleAttribute("hidden", hasFile)
    })

    // Hide all file elements when we don't have a file
    document.querySelectorAll("[file]").forEach(el => {
      el.toggleAttribute("hidden", !hasFile)
    })
  }

  /**
   * Updates the validationResults element with the data from the back end.
   *
   * @param {object} result - The validation information from the back end.
   */
  function updateValidationResults(result) {
    try {
      const container = document.getElementById("validationResults")

      // Store results globally so toggleErrorsOnly can access them
      lastValidationResults = result

      const hasFile = result && result.length > 0

      setHasFile(hasFile)

      if(!hasFile)
        return

      const invalidCountElement = document.getElementById("invalidCount")

      if(!invalidCountElement)
        throw new Error("Missing 'invalidCount'")

      const invalidItems = result.filter(r => r.status === "invalid")

      if(invalidItems.length > 0) {
        invalidCountElement.classList.remove("hidden")
      } else {
        invalidCountElement.classList.add("hidden")
      }

      invalidCountElement.textContent = invalidItems.length

      // Apply filters
      const showOnlyErrorElement = document.getElementById("showOnlyErrors")

      if(!showOnlyErrorElement)
        throw new Error("Missing 'showOnlyErrors'")

      const showOnlyErrors = showOnlyErrorElement.checked

      const propertyFilterElement = document.getElementById("propertyFilter")

      if(!propertyFilterElement)
        throw new Error("Missing 'propertyFilter'")

      const propertyFilter = document.getElementById("propertyFilter").value.toLowerCase()

      // If user is filtering only errors but there are none, auto-expand
      if(showOnlyErrors && invalidItems.length === 0 && !autoExpanding) {
        autoExpanding = true
        showOnlyErrorElement.checked = false
        // Re-render full list next frame
        requestAnimationFrame(() => {
          updateValidationResults(result)
          autoExpanding = false
        })

        return
      }

      let filteredResults = showOnlyErrors ? invalidItems : result

      // Filter by property name if filter text is provided
      if(propertyFilter) {
        filteredResults = filteredResults.filter(result =>
          result.property.toLowerCase().includes(propertyFilter)
        )
      }

      const displayResults = filteredResults

      const template = document.getElementById("validation-item-template")

      // Build map of existing items keyed by property for in-place updates
      const existing = new Map(
        Array.from(container.querySelectorAll(".validation-item"))
          .map(node => [node.dataset.prop, node])
      )

      // Track which properties we will show this render
      const toShow = new Set(displayResults.map(r => r.property))

      // Animate unless this call is from a filter operation
      const allowAnimate = !suppressAnimation

      displayResults.forEach((entry, index) => {
        let root = existing.get(entry.property)
        let isNew = false

        if(!root) {
          const fragment = template.content.cloneNode(true)
          const created = fragment.querySelector(".validation-item")

          if(!created)
            return

          root = created
          root.dataset.prop = entry.property
          isNew = true
        }

        const propEl = root.querySelector(".validation-property")
        const schemaDescEl = root.querySelector(".schema-description")
        const valueEl = root.querySelector(".validation-value")
        const descEl = root.querySelector(".validation-description")

        if(propEl) {
          if(propEl.textContent !== entry.property)
            propEl.textContent = entry.property

          if(!propEl.dataset.bound) {
            propEl.dataset.bound = "true"
            propEl.title = "Click to copy property name"
          }
        }

        if(schemaDescEl && schemaDescEl.textContent !== (entry.schemaDescription ?? ""))
          schemaDescEl.textContent = entry.schemaDescription ?? ""

        if(valueEl) {
          const oldStatus = valueEl.classList.contains("invalid") ? "invalid" : (valueEl.classList.contains("valid") ? "valid" : null)
          const valueChanged = valueEl.textContent !== entry.value

          if(valueChanged)
            valueEl.textContent = entry.value

          if(oldStatus !== entry.status) {
            valueEl.classList.remove("invalid", "valid")
            // Force reflow so removing class registers before adding new
            // (helps some browsers animate)
            void valueEl.offsetWidth
            valueEl.classList.add(entry.status)
          }
        }

        if(descEl) {
          const descChanged = descEl.textContent !== entry.description

          if(descChanged)
            descEl.textContent = entry.description

          if(entry.status === "invalid")
            descEl.classList.add("invalid")
          else
            descEl.classList.remove("invalid")
        }

        if(isNew) {
          // Start off-screen for roll-in
          root.classList.remove("roll-in")
          container.appendChild(root)
          if(allowAnimate) {
            requestAnimationFrame(() => {
              setTimeout(() => {
                root.classList.add("roll-in")
              }, index * 14)
            })
          } else {
            root.classList.add("roll-in")
          }
        }
      })

      // Remove nodes not in current filtered set with dissolve animation
      existing.forEach((node, prop) => {
        if(!toShow.has(prop)) {
          node.remove()
        }
      })
    } catch(e) {
      console.error(e)
    }
  }

  // Delegate click events for property copy
  document.addEventListener("click", e => {
    const el = e.target.closest(".validation-item")

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
  })
}
