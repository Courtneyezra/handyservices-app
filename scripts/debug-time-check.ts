import { isWithinUKBusinessHours } from '../server/call-routing-engine';

// Settings from the screenshot
const settings = {
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessDays: '1,2,3,4,5', // Mon-Fri
};

const now = new Date();

console.log('\n🕐 Time Debug Information');
console.log('='.repeat(50));

// Show current time in different zones
console.log('\n📍 Current Time Information:');
console.log(`System Time (Vietnam): ${now.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}`);
console.log(`UK Time: ${now.toLocaleString('en-GB', { timeZone: 'Europe/London' })}`);
console.log(`UTC Time: ${now.toISOString()}`);

// Get UK time components
const ukFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'long',
    hour12: false,
    year: 'numeric',
    month: 'long',
    day: 'numeric'
});

console.log(`\n🇬🇧 UK Time Breakdown:`);
const ukParts = ukFormatter.formatToParts(now);
ukParts.forEach(part => {
    if (part.type !== 'literal') {
        console.log(`  ${part.type}: ${part.value}`);
    }
});

const currentHour = parseInt(ukParts.find(p => p.type === 'hour')?.value || '0');
const currentMinutes = parseInt(ukParts.find(p => p.type === 'minute')?.value || '0');

// Get day of week
const ukDayFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short'
});
const dayName = ukDayFormatter.format(now);
const dayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
const currentDay = dayMap[dayName] || 0;
const adjustedDay = currentDay === 0 ? 7 : currentDay;

console.log(`\n📊 Routing Logic Values:`);
console.log(`  UK Hour: ${currentHour}`);
console.log(`  UK Minutes: ${currentMinutes}`);
console.log(`  UK Day Name: ${dayName}`);
console.log(`  Current Day (JS format): ${currentDay} (0=Sun)`);
console.log(`  Adjusted Day (Our format): ${adjustedDay} (1=Mon, 7=Sun)`);

console.log(`\n⚙️ Business Hours Settings:`);
console.log(`  Start: ${settings.businessHoursStart}`);
console.log(`  End: ${settings.businessHoursEnd}`);
console.log(`  Business Days: ${settings.businessDays}`);

// Parse business hours
const [startHour, startMin] = settings.businessHoursStart.split(':').map(Number);
const [endHour, endMin] = settings.businessHoursEnd.split(':').map(Number);
const businessDays = settings.businessDays.split(',').map(Number);

const currentTimeMinutes = currentHour * 60 + currentMinutes;
const startTimeMinutes = startHour * 60 + startMin;
const endTimeMinutes = endHour * 60 + endMin;

console.log(`\n🔢 Time Comparison (in minutes):`);
console.log(`  Current Time: ${currentTimeMinutes} (${currentHour}:${String(currentMinutes).padStart(2, '0')})`);
console.log(`  Start Time: ${startTimeMinutes} (${startHour}:${String(startMin).padStart(2, '0')})`);
console.log(`  End Time: ${endTimeMinutes} (${endHour}:${String(endMin).padStart(2, '0')})`);

const isBusinessDay = businessDays.includes(adjustedDay);
const isWithinHours = currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes;

console.log(`\n✅ Condition Checks:`);
console.log(`  Is Business Day? ${isBusinessDay} (${adjustedDay} in [${businessDays.join(', ')}])`);
console.log(`  Is Within Hours? ${isWithinHours} (${currentTimeMinutes} >= ${startTimeMinutes} && ${currentTimeMinutes} < ${endTimeMinutes})`);

console.log(`\n🎯 Final Result:`);
const result = isWithinUKBusinessHours(settings);
console.log(`  isWithinUKBusinessHours: ${result}`);

if (result) {
    console.log(`\n✅ WITHIN business hours - Call should route to VA`);
} else {
    console.log(`\n❌ OUTSIDE business hours - Call should route to Eleven Labs`);
}

console.log('\n' + '='.repeat(50));
