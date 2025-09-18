export default class Validator {
  static async validate(schema, userColors) {
    try {
      const results = []

      for(const [key, value] of Object.entries(userColors)) {
        if(schema.has(key)) {
          const propertySchema = schema.get(key)

          const validationResult =
            this.#validateColorProperty(key, value, propertySchema)

          results.push({
            property: key,
            status: validationResult.isValid ? "valid" : "invalid",
            description: validationResult.isValid
              ? propertySchema.description || "No description available"
              : validationResult.error,
            value: value,
            schemaDescription: validationResult.isValid
              ? undefined
              : propertySchema.description
          })
        } else {
          results.push({
            property: key,
            status: "invalid",
            description: `Property ${key} is not allowed.`,
            value: value
          })
        }
      }

      return results
    } catch(error) {
      console.error(error)
      throw error
    }
  }

  // Check hex color format
  static #colourHex = /^#(?:[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?|[a-fA-F0-9]{3}(?:[a-fA-F0-9]{1})?)$/

  static #validateColorProperty(key, value, propertySchema) {
    // Check if value is string (required for colors)
    if(typeof value !== "string") {
      return {
        isValid: false,
        error: "Color values must be strings"
      }
    }

    if(!(value === "default" || this.#colourHex.test(value))) {
      return {
        isValid: false,
        error: "Invalid color format. Use #RGB, #RGBA, #RRGGBB or #RRGGBBAA."
      }
    }

    // Check for transparency requirements from schema patterns
    if(propertySchema && propertySchema.oneOf) {
      for(const option of propertySchema.oneOf) {
        if(option.pattern && option.patternErrorMessage) {
          // Check if this is a transparency requirement pattern
          const {pattern,patternErrorMessage} = option

          const patternRegExp = new RegExp(pattern)

          if(!patternRegExp.test(value)) {
            return {
              isValid: false,
              error: patternErrorMessage ??
                     "This color must be transparent to avoid obscuring content."
            }
          }
        }
      }
    }

    return {isValid: true}
  }
}
