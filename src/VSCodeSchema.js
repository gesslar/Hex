import * as vscode from "vscode"
import JSON5 from "json5"

export default class VSCodeSchema {
  static #schemaUri = "vscode://schemas/workbench-colors"
  static #instance = null

  #schema = new Map()
  #defs = new Map()

  constructor(schemaData) {
    const resolvedSchema = this.#resolveSchema(
      JSON5.parse(schemaData)
    )

    this.#schema = resolvedSchema
  }

  static async new() {
    if(this.#instance)
      return this.#instance

    try {
      // Setup the schema
      const schemaUri = vscode.Uri.parse(this.#schemaUri)
      const schema = await vscode.workspace.openTextDocument(schemaUri)
      const data = schema.getText()
      const instance = new VSCodeSchema(data)

      this.#instance = instance

      return instance
    } catch(error) {
      console.error(error)
      throw error
    }
  }

  #resolveSchema(loaded) {
    const refPattern = /^#\/\$(?<cat>\w+)\/(?<def>.*)$/
    const {properties,$defs: defs} = loaded
    const schema = new Map()

    for(const [k,v] of Object.entries(properties)) {
      const work = v

      if(v.$ref) {
        const ref = v.$ref

        delete v.$ref

        const {cat,def,value} = resolveReference.call(this, ref,defs)

        recordDefinition.call(this, {cat,def,value})

        Object.assign(work, value)
      }

      if(v.oneOf) {
        const oneOf = v.oneOf

        oneOf.forEach(el => {
          if(el.$ref) {
            const ref = el.$ref

            delete(el.$ref)
            const {cat,def,value} = resolveReference.call(this, ref,defs)

            recordDefinition.call(this, {cat,def,value})

            Object.assign(el, value)
          }
        })

        work.oneOf = oneOf

        for(const el of oneOf) {
          if(el.deprecationMessage) {
            work.deprecationMessage = el.deprecationMessage
            break
          }
        }
      }

      // Derive alpha requirement by executing patterns rather than brittle string inspection
      try {
        let allows6 = false
        let allows8 = false

        if(Array.isArray(work.oneOf)) {
          for(const opt of work.oneOf) {
            if(!opt || !opt.pattern)
              continue

            try {
              const re = new RegExp(opt.pattern)

              if(re.test("#ffffff"))
                allows6 = true

              if(re.test("#ffffffaa"))
                allows8 = true
            } catch(_) {
              // Ignore malformed pattern entries
            }
          }
        }

        work.alphaRequired = allows8 && !allows6

        if(!Object.prototype.hasOwnProperty.call(work, "sample"))
          work.sample = work.alphaRequired ? "#ffffffaa" : "#ffffff"
      } catch(_) {
        // Ignore derivation issues silently
      }

      schema.set(k,work)
    }

    return schema

    /**
     * Resolve a reference to its definition in the definitions object.
     *
     * @param {string} ref - The reference to resolve
     * @param {object} defs - The definitions object.
     * @returns {object} The category, definition name, and the definition.
     */
    function resolveReference(ref, defs) {
      const {cat,def} = refPattern.exec(ref)?.groups ?? {}

      if(!cat || !def)
        throw new Error(`Invalid reference/definition pair for ${JSON.stringify(ref)}.`)

      if(!defs[def])
        throw new Error(`No definition for ${ref}`)

      return {
        cat,
        def,
        value: defs[def]
      }
    }

    /**
     * Record a definition that has been previously resolved in the #defs map.
     *
     * @param {object} args - The argments.
     * @param {string} args.cat - The category
     * @param {string} args.def - The definition to add
     * @param {object} args.value - The value of the definition
     */
    function recordDefinition({cat,def,value}) {
      if(!this.#defs.has(cat))
        this.#defs.set(cat, new Map())

      if(!this.#defs.get(cat).get(def))
        this.#defs.get(cat).set(def, value)
    }
  }

  valueOf() {
    return this.#schema
  }

  // Preferred explicit accessors
  get map() {
    return this.#schema
  }

  get size() {
    return this.#schema.size
  }
}
