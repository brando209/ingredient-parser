const { unitMap } = require('./src/units');
const { toNumberFromString, convertUnicodeFractions } = require('./src/utils');
/*
    Extracts measurement information from an ingredient string.
    Assumes that the string has the forms:
        "[Quantity | QuantityRange] [Unit] [(<optional>)] [Ingredient] [(<optional>) | , <optional>]"
        "[Quantity | QuantityRange] [Unit] [/[Quantity | QuantityRange] [Unit]] [(<optional>)] [Ingredient] [(<optional>) | , <optional>]"
        "[Quantity | QuantityRange] [Unit] [([Quantity | QuantityRange] [Unit])] [(<optional>)] [Ingredient] [(<optional>) | , <optional>]"

    Returns a tuple. The first entry is a tuple containing objects of the form below where the first entry is the first measurement
    found and the second entry is a converted measurement, if found, or null.
        {
            quantity:   Number | [Number]
            unit:       String
            isRange:    Boolean
        }
    The second entry is the input ingredient string with the measurement information removed
*/
function extractMeasurement(ingredientString) {
    const measurements = [];
    const measurement = {
        quantity: null,
        unit: null,
        isRange: false
    };
    const conversion = {
        quantity: null,
        unit: null,
        isRange: false
    }

    //Pre-process string
    ingredientString = convertUnicodeFractions(ingredientString);
    //If there is a slash directly preceeded by a non-digit, assume it is a measurement conversion and add a
    //space before the slash. Ex: '28g/1oz flour' becomes '28g /1oz flour'.
    ingredientString = ingredientString.replace(/(?<!\d)\//, ' /');
    //If there is an opening parens immediately proceeded by a digit and immediately preceeded by a non-digit,
    //assume it is a measurement conversion. Ex: '28g(1oz) flour' becomes '28g (1oz) flour'.
    ingredientString = ingredientString.replace(/(?<!\d)\((?=\d)/, ' (');

    //Extract the measurement quantity. Assumes measurement is at start of string.
    //If quantity is a range, assumes it to be structured like: '1-2' or '1 to 2' (may include whitespace in between)
    //Quantity may have fractions(Ex: '1/2 cup'). These fractions may be mixed with range(Ex: '1 1/2 to 2 cups).
    const quantityRegex = /^(\d+\/*\d*)\s*(\d\/\d)*\s*(\-|to)*\s*(\d+\/*\d*)*\s*(\d\/\d)*\s*/;
    //Five groups are captured:
    //  1. First number/fraction(may not be whole, ex: '1/2 cup')
    //  2. Fractional part of min range value (if exists)
    //  3. Range identifier, '-' or 'to' (if exists)
    //  4. Second number/fraction (if exists)
    //  5. Fractional part of max range value (if exists)
    let quantityStringLength = 0; //Length of the quantity portion of the string
    const quantityMatch = ingredientString.replace(/^an?\s+/i, "1 ").match(quantityRegex);

    if(quantityMatch) {
        const [minNum, minFrac] = [quantityMatch[1], quantityMatch[2]];
        const isRange = quantityMatch[3];
        const [maxNum, maxFrac] = [quantityMatch[4], quantityMatch[5]]
        //Length of measurement quantity portion of string
        quantityStringLength = quantityMatch[0].length;
        
        const minQuantity = toNumberFromString(minNum) + toNumberFromString(minFrac);
        const maxQuantity = toNumberFromString(maxNum) + toNumberFromString(maxFrac);
        
        if(isRange) {
            measurement.isRange = true;
            measurement.quantity = [minQuantity, maxQuantity];
        } else measurement.quantity = minQuantity;
    }
    
    let ingredientStringWithoutQuantity = ingredientString.substring(quantityStringLength).trim();
    let ingredientStringWithoutQuantityAndUnit = ingredientStringWithoutQuantity;
    
    //Extract the measurement unit
    //If the unit is 'bag', 'box', 'can', or 'package', it may come with a second measurement that gives the size
    //of the package(Ex: '1 (8 oz.) can of tomato paste' or '2 cans of tomato paste (8oz)'. Check this first and move second
    //measurement to the end of the string.
    const packageRegex = /\b(bags?|boxe?s?|cans?|packages?|pkgs?\.?)\b/i
    const packageMatch = ingredientStringWithoutQuantity.match(packageRegex);
    if(packageMatch) {
        ingredientStringWithoutQuantityAndUnit = ingredientStringWithoutQuantityAndUnit.slice(packageMatch.index + packageMatch[0].length).trim() + " " + ingredientStringWithoutQuantityAndUnit.slice(0, packageMatch.index).trim();
        measurement.unit = unitMap.get(packageMatch[0].replace(".", "").toLowerCase().trim());
    }

    let unitStringLength = 0; //Length of measurement unit portion of string
    let unitStringStart = 0; //Index of start of unit portion of string
    //If the unit is not 'bag', 'box', etc., assume the unit comes directly after the quantity(Ex: '4 oz. cheese').
    const unitRegex = /\b(cups?|c\.?|cloves?|gallons?|gals?\.?|ounces?|oz\.?|pints?|pts?\.?|pounds?|lbs?\.?|quarts?|qts?\.?|tablespoons?|tbsp?n?s?\.?|teaspoons?|tspn?s?\.?|grams?|g\.?|kilograms?|kgs?\.?|liters?|lt?\.?|milligrams?|mgs?\.?|milliliters?|mls?\.?|pieces?|pcs?\.?|pinche?s?|slices?|sticks?|small|sm\.?|medium|med\.?|large|lg\.?)(?!\S)/i
    //One group is captured: the unit (without ending period, if any)
    const unitMatch = ingredientStringWithoutQuantityAndUnit.match(unitRegex);
    const conversionRegex = /^(\(|\/)\s*(\d+\/*\d*)\s*(\d\/\d)*\s*(cups?|c\.?|gallons?|gals?\.?|ounces?|oz\.?|pints?|pts?\.?|pounds?|lbs?\.?|quarts?|qts?\.?|tablespoons?|tbsp?n?s?\.?|teaspoons?|tspn?s?\.?|grams?|g\.?|kilograms?|kgs?\.?|liters?|lt?\.?|milligrams?|mgs?\.?|milliliters?|mls?\.?|pieces?|pcs?\.?|pinche?s?|pieces?|pcs?\.?|slices?|sticks?)(\)?)/;
    let conversionMatch, conversionStringLength = 0;
    if(!packageMatch && unitMatch) {
        unitStringLength = unitMatch[0].length;
        unitStringStart = unitMatch.index;

        measurement.unit = unitMap.get(unitMatch[1].replace(".", "").toLowerCase().trim());
        ingredientStringWithoutQuantityAndUnit = ingredientStringWithoutQuantityAndUnit.slice(0, unitStringStart).trim() + (unitStringStart > 0 ? " " : "") + ingredientStringWithoutQuantityAndUnit.substring(unitStringStart + unitStringLength).trim();

        //Decide if there is a measurement conversion next. Ex: '28 grams/1oz sugar' or '28 g (1 oz.) sugar'
        conversionMatch = ingredientStringWithoutQuantityAndUnit.match(conversionRegex);

        if(conversionMatch) {
            conversionStringLength = conversionMatch[0].length;
            conversion.quantity = toNumberFromString(conversionMatch[2]) + toNumberFromString(conversionMatch[3]);
            conversion.unit = unitMap.get(conversionMatch[4].replace(".", "").toLowerCase().trim());

            ingredientStringWithoutQuantityAndUnit = ingredientStringWithoutQuantityAndUnit.substring(conversionStringLength).trim();

            measurements[1] = conversion;
        }
    }

    measurements[0] = measurement;

    return [measurements, ingredientStringWithoutQuantityAndUnit]
}

//TODO: Seperate ingredient name from the rest of the ingredient string, if any.
//Ex: extractName('garlic') returns ['garlic', null]
//Ex: extractName('garlic, minced') returns ['garlic', 'minced']
//Ex: extractName('garlic (peeled and chopped)') returns ['garlic', '(peeled and chopped)']
function extractName(ingredientString) {
    return [ingredientString.trim().replace(/^of\s/, ""), null];
}

function parse(ingredientString) {
    const result = {
        name: null,
        measurement: null,
        convertedMeasurement: null,
        additional: null
    }

    const [[measurement, converted], restOfIngredientString] = extractMeasurement(ingredientString);
    result.measurement = measurement;
    result.convertedMeasurement = converted;

    const [name, additionalDetails] = extractName(restOfIngredientString);
    result.name = name;
    result.additional = additionalDetails;

    return result;
}

parse('¼ cup cheese');

exports.parse = parse;