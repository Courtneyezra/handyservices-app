import { validateBusinessHours } from '../server/call-routing-engine';

const result = validateBusinessHours('08:00', '18:00', []);
console.log('Result:', JSON.stringify(result, null, 2));
console.log('isValid:', result.isValid);
console.log('error:', result.error);
console.log('error includes "at least one":', result.error?.includes('at least one'));
