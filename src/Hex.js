import {Glog} from "@gesslar/toolkit"
import * as vscode from "vscode"

import HexCommands from "./HexCommands.js"
import HexPanel from "./HexPanel.js"
import VSCodeSchema from "./VSCodeSchema.js"

/**
 * Activates the Hex extension and registers commands and panels.
 */
export async function activate(context) {
  const glog = new Glog({
    displayName: false,
    name: "Hex",
    prefix: "[HEX]",
    env: "extension"
  })
  const schema = await VSCodeSchema.new()
  const commandProvider = new HexCommands()
  const hexPanel = new HexPanel(context, schema, glog)

  context.subscriptions.push(
    commandProvider,
  )

  context.subscriptions.push(
    vscode
      .commands
      .registerCommand("hex.show", async() => {
        await commandProvider.showWebview(context, hexPanel)
      }),

    vscode
      .commands
      .registerCommand("hex.select", async() => {
        await hexPanel.selectFile()
      }),

    vscode
      .commands
      .registerCommand("hex.validate", async resourceUri => {
        await hexPanel.selectFile(resourceUri)
      })
  )
}
