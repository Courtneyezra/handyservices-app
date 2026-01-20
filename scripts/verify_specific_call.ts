
import 'dotenv/config';
import { analyzeLeadActionPlan } from '../server/services/agentic-service';

async function verifySpecificCall() {
    const transcript = `Hello. Good afternoon. I'm looking for someone to to do a reseal of my bathroom, shower Pardon? Hello? Yeah. Just a shower at the moment. Yes. I will say so. I'll what I because I was having dumps from upstairs going downstairs. So I noticed noticed that the seal is pulling off, so I I I bought the tool and everything to do it myself, but I can't. So I need somebody to strip the silicone and leak reseal it. You're breaking up. I can't hear you so well. Pardon? I need to get a chemical. Hear you so well, darling. Your phone is breaking call, or is it mine? No. Let me let me hang up and call back it might help. I don't know. I can't hear you so well.`;
    const customerName = "Darling";

    console.log("🤖 Running Analysis on 'Shana/Darling' Transcript...");

    try {
        const plan = await analyzeLeadActionPlan(transcript, customerName);
        console.log("✅ Analysis Successful!");
        console.log("Recommended Action:", plan.recommendedAction);
        console.log("Draft Reply:", plan.draftReply);
        console.log("Visit Reason:", plan.visitReason);
    } catch (error) {
        console.error("❌ Analysis Failed:", error);
    }
    process.exit(0);
}

verifySpecificCall();
