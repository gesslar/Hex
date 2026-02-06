// CommonJS wrapper for ESM extension logic
// This file is the entry point for VS Code (see package.json "main")

let esm

/**
 * Ensures the ESM module is loaded.
 *
 * @returns {Promise<any>} The imported ESM module.
 */
async function ensureESM() {
  if(!esm)
    esm = await import("./Hex.js")

  return esm
}

/**
 * Activates the extension by delegating to the ESM module.
 *
 * @param {import('vscode').ExtensionContext} context - The VS Code extension context.
 * @returns {Promise<void>}
 */
async function activate(context) {
  const mode = await ensureESM()

  await mode?.activate(context)
}

/**
 * Deactivates the extension by delegating to the ESM module.
 *
 * @returns {Promise<void>}
 */
async function deactivate() {
  const mod = await ensureESM()

  if(mod.deactivate) {
    return mod.deactivate()
  }
}

// VS Code expects CommonJS exports
module.exports = {
  activate,
  deactivate
}
