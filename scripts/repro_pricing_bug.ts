
import { generateValuePricingQuote } from '../server/value-pricing-engine';
import { ValuePricingInputs } from '../shared/schema';

const testInputs: ValuePricingInputs = {
    // jobDescription: "Fix a leaking tap", // This was causing a lint error and is not in ValuePricingInputs
    baseJobPrice: 15000, // £150
    urgencyReason: 'med',
    ownershipContext: 'homeowner',
    desiredTimeframe: 'week',
    clientType: 'homeowner',
    jobComplexity: 'low'
};

const result = generateValuePricingQuote(testInputs);

console.log('--- Test Case 1: Standard Homeowner Job (£150), Low Complexity ---');
console.log('Style:', result.quoteStyle);
console.log('Essential:', result.essential.price);
console.log('HassleFree:', result.hassleFree.price);
console.log('HighStandard:', result.highStandard.price);

const testInputsSmall: ValuePricingInputs = {
    ...testInputs,
    baseJobPrice: 8000, // £80
    forcedQuoteStyle: 'hhh' // Force HHH mode
};

const resultSmall = generateValuePricingQuote(testInputsSmall);

console.log('\n--- Test Case 2: Small Job (£80) [FORCED HHH] ---');
console.log('Style:', resultSmall.quoteStyle);
console.log('Essential:', resultSmall.essential.price);
console.log('HassleFree:', resultSmall.hassleFree.price);
console.log('HighStandard:', resultSmall.highStandard.price);

const testInputsTrivial: ValuePricingInputs = {
    ...testInputs,
    jobComplexity: 'trivial',
    forcedQuoteStyle: 'hhh' // Force HHH mode
};

const resultTrivial = generateValuePricingQuote(testInputsTrivial);

console.log('\n--- Test Case 3: Trivial Complexity [FORCED HHH] ---');
console.log('Style:', resultTrivial.quoteStyle);
console.log('Essential:', resultTrivial.essential.price);
console.log('HassleFree:', resultTrivial.hassleFree.price);
console.log('HighStandard:', resultTrivial.highStandard.price);
