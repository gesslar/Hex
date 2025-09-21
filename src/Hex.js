import * as vscode from "vscode"

import HexCommands from "./HexCommands.js"
import HexPanel from "./HexPanel.js"
import VSCodeSchema from "./VSCodeSchema.js"

/**
 * Activates the extension.
 *
 * @param {import('vscode').ExtensionContext} context - The VS Code extension context.
 * @returns {void}
 */
export async function activate(context) {
  const schema = await VSCodeSchema.new()

  // Grab the app's state
  const panelState = context.workspaceState.get("hexPanelState", {})

  // Register providers
  const commandProvider = new HexCommands(schema)
  const panelProvider = new HexPanel(context, schema, panelState)
  const webviewProvider = vscode.window.registerWebviewViewProvider(
    HexPanel.viewType, panelProvider)

  context.subscriptions.push(
    commandProvider,
    panelProvider,
    webviewProvider
  )

  // Register commands
  // Extract the schema
  context.subscriptions.push(
    vscode.commands.registerCommand("hex.extract", async() => {
      commandProvider.extract()
    }),

    // Focus the filter textbox inside the webview
    vscode.commands.registerCommand("hex.focusFilter", () => {
      panelProvider.focusFilter()
    }),

    // Copy missing properties scaffold to clipboard
    vscode.commands.registerCommand("hex.copyMissingProperties", async() => {
      await panelProvider.copyMissingProperties()
    })
  )

  // Register toolbar commands
  context.subscriptions.push(
    // Open a theme file to audit
    vscode.commands.registerCommand("hex.selectFile", async() => {
      try {
        await panelProvider.selectFile()
      } catch(error) {
        console.error(error)
        throw error
      }
    }),

    // Refresh/force reparse.
    vscode.commands.registerCommand("hex.refresh", async() => {
      await panelProvider.refresh()
    })
  )

  // Set up state change listener (assuming your panel has this method)
  panelProvider.onStateChange(async newState => {
    await context.workspaceState.update("hexPanelState", newState)
  })
}

/**
 * Deactivates the extension.
 *
 * @returns {void}
 */
export function deactivate() {
}
