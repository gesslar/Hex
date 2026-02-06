import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

import YAML from "yaml"
import JSON5 from "json5"

import VSCodeSchema from "./VSCodeSchema.js"

export default class HexCommands {
  #schema = null

  async showWebview(context, webviewProvider) {
    webviewProvider.showWebview(context)
  }

  async extract() {
    try {
      const config = vscode.workspace.getConfiguration("gesslar.hex")
      const extractMode = config.get("extractMode")
      const outputFormat = config.get("outputFormat")
      const outputPath = config.get("outputPath")

      switch(extractMode) {
        case "clipboard":
          return await this.#extractToClipboard(outputFormat)
        case "console":
          return await this.#extractToConsole(outputFormat)
        case "file":
          return await this.#extractToFile(outputFormat, outputPath)
      }

      throw new Error(`Unknown extractMode '${extractMode}'.`)
    } catch(error) {
      vscode.window.showErrorMessage(error.message)
      console.error(error.message)
    }
  }

  async #prepareExport(format) {
    this.#schema = this.#schema || (await VSCodeSchema.new()).map

    const exporter =
      (format === "json5" && (data => JSON5.stringify(data, null, 2))) ||
      (format === "yaml" && (data => YAML.stringify(data))) ||
      null

    if(!exporter)
      throw new Error(`Unknown export format: '${format}'`)

    return exporter(Object.fromEntries(this.#schema))
  }

  async #extractToConsole(format) {
    const exported = await this.#prepareExport(format)

    process.stdout.write(exported)

    vscode.window.showInformationMessage("Saved to the console.")
  }

  async #extractToClipboard(format) {
    const exported = await this.#prepareExport(format)

    await vscode.env.clipboard.writeText(exported)

    vscode.window.showInformationMessage("Saved to the clipboard.")
  }

  async #extractToFile(format, destPath) {
    if(!destPath)
      throw new Error("Missing file path for file export.")

    const exported = await this.#prepareExport(format)
    const fileName = vscode.Uri.joinPath(destPath, `WorkbenchColors.${format}`)
    const destination = this.#resolvePath(fileName)

    // Can we write?
    await fs.access(destination, fs.constants.W_OK)

    // Ok, if that threw, we wouldn't be here, so let's git'er done!
    await fs.writeFile(destination, exported, "utf8")

    vscode.window.showInformationMessage(`Saved to '${destination}'`)
  }

  #resolvePath(filePath) {
    if(filePath.startsWith("~"))
      return path.join(os.homedir(), filePath.slice(1))

    return path.resolve(filePath)
  }
}
