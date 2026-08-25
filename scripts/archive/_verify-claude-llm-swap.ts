import 'dotenv/config';
import { extractJobSummary, generateWhatsAppMessage, determineQuoteStrategy, classifyLead } from '../server/openai';

const TRANSCRIPT = `Speaker 0: Handy Services, how can I help?
Speaker 1: Hi, yeah, I've got a leaking tap in the kitchen and my fence blew down in the wind last week.
Speaker 0: No problem, we can sort that. Can I just take your name?
Speaker 1: It's Sarah.
Speaker 0: Thanks Sarah, and the property address?
Speaker 1: 12 Elm Grove, Nottingham, NG5 2FT.`;

async function main() {
    const summary = await extractJobSummary(TRANSCRIPT);
    console.log('jobSummary:', JSON.stringify(summary));
    const msg = await generateWhatsAppMessage(TRANSCRIPT, 'Sarah', 'casual');
    console.log('whatsapp:', JSON.stringify(msg));
    const strat = await determineQuoteStrategy('leaking kitchen tap and fence panel replacement');
    console.log('strategy:', JSON.stringify(strat));
    const lead = await classifyLead('leaking kitchen tap and fence panel blew down, no rush');
    console.log('lead:', JSON.stringify(lead));
    process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
