/**
 * Color validation module for Hex extension.
 *
 * @module Validator
 * @example
 * // Import types in other files:
 * // @typedef {import('./Validator.js').ValidationResult} ValidationResult
 * // @typedef {import('./Validator.js').PropertySchema} PropertySchema
 */

/**
 * Result of validating a single color property.
 *
 * @typedef {object} ValidationResult
 * @property {string} property - The property key that was validated
 * @property {"valid"|"warn"|"invalid"} status - Whether the property passed validation
 * @property {string} description - Schema description of the color property
 * @property {string} value - The color value that was validated
 * @property {string} [message] - Error or deprecation message when status is not "valid"
 */

/**
 * Internal validation result from property check.
 *
 * @typedef {object} PropertyValidationResult
 * @property {boolean} isValid - Whether the property is valid
 * @property {string} [error] - Error message if invalid
 */

/**
 * A pattern option within a property schema.
 *
 * @typedef {object} SchemaPatternOption
 * @property {string} [pattern] - Regex pattern to match
 * @property {string} [patternErrorMessage] - Error message when pattern fails
 */

/**
 * Schema definition for a color property.
 *
 * @typedef {object} PropertySchema
 * @property {string} [description] - Description of the color property
 * @property {SchemaPatternOption[]} [oneOf] - Array of pattern options to validate against
 * @property {string} [deprecationMessage] - Deprecation message if property is deprecated
 */

/**
 * Validates user color configurations against a schema.
 *
 * @class
 */
export default class Validator {
  /**
   * Validates user colors against a schema definition.
   *
   * @param {Map<string, PropertySchema>} schema - Map of property names to their schema definitions
   * @param {Record<string, string>} userColors - Object of color property names to color values
   * @returns {Promise<ValidationResult[]>} Array of validation results for each property
   */
  static async validate(schema, userColors) {
    try {
      const results = []

      for(const [key, value] of Object.entries(userColors)) {
        if(schema.has(key)) {
          const propertySchema = schema.get(key)

          const validationResult =
            this.#validateColorProperty(key, value, propertySchema)

          const isDeprecated = !!propertySchema.deprecationMessage

          results.push({
            property: key,
            status: isDeprecated ? "warn"
              : validationResult.isValid ? "valid"
              : "invalid",
            description: propertySchema.description || "No description available",
            value: value,
            message: isDeprecated
              ? propertySchema.deprecationMessage
              : validationResult.isValid ? undefined
              : validationResult.error
          })
        } else {
          results.push({
            property: key,
            status: "invalid",
            description: "",
            value: value,
            message: `Property ${key} is not allowed.`
          })
        }
      }

      return results
    } catch(error) {
      console.error(error)
      throw error
    }
  }

  /**
   * Regular expression for validating hex color formats.
   * Matches #RGB, #RGBA, #RRGGBB, and #RRGGBBAA.
   *
   * @type {RegExp}
   * @private
   */
  static #colourHex = /^#(?:[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?|[a-fA-F0-9]{3}(?:[a-fA-F0-9]{1})?)$/

  /**
   * Validates a single color property against its schema.
   *
   * @param {string} _key - The property key (unused, for potential future logging)
   * @param {string} value - The color value to validate
   * @param {PropertySchema} propertySchema - The schema definition for this property
   * @returns {PropertyValidationResult} Validation result with isValid flag and optional error
   * @private
   */
  static #validateColorProperty(_key, value, propertySchema) {
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
