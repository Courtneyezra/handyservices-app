import 'dotenv/config';
import { getTwilioSettings } from '../server/settings';
const s: any = await getTwilioSettings();
const keys = ['agentMode','businessHoursStart','businessHoursEnd','businessDays','forwardEnabled','forwardNumber','maxWaitSeconds','fallbackAction','elevenLabsAgentId','elevenLabsBusyAgentId'];
for (const k of keys) console.log(`${k.padEnd(22)} = ${JSON.stringify(s[k])}`);
// what mode would 07:21 UK Wed resolve to?
const { determineCallRouting } = await import('../server/call-routing-engine');
process.exit(0);
