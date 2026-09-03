/**
 * P17 items 2-5: the four 31 Aug incident sends the guards should have held, and the near-misses
 * from the same corpus that must stay fine.
 *
 * Every string here is a real body out of eval-cases/guards. The pairs matter more than the
 * catches: "we'll get a time sorted for someone to pop round" and "the PM time for Craig's visit"
 * are one word apart and land on opposite sides of the line.
 */
import { describe, it, expect } from 'vitest';
import { detectSoftCommitment, checkDraft } from './draft-guards';

const clean = (body: string) => checkDraft({ body, intent: 'unknown', quoteSeen: false });

describe('detectSoftCommitment — the four sends that went out unguarded', () => {
    it('163c5f9b30: promises a time window for a named contractor visit', () => {
        expect(detectSoftCommitment("Hi Dani, no worries about the late message. 👍\n\nI'll get back to you shortly with the PM time for Craig's visit.")).toBe("PM time for Craig's visit");
    });
    it('26b662f923: asks her to nominate the slot in chat', () => {
        expect(detectSoftCommitment("What's the best time to schedule after your delivery on 2nd September?")).toBe("What's the best time to schedule");
    });
    it('e0ee83c869: commits to a fixing method onto a substrate nobody has seen', () => {
        expect(detectSoftCommitment("No stress, we'll attach it to your concrete floor.")).toBe('attach it to your concrete floor');
    });
    it('e0ee83c869: the vague half of the same message is deliberately NOT caught', () => {
        // "we'll sort a time to pop round" names no window and asks her to choose nothing, so it
        // reads exactly like the fine legacy sends. The case is held by the sentence above it,
        // which is the right reason to hold it: the method, not the vagueness.
        expect(detectSoftCommitment("Just give us a shout once it's arrived and we'll sort a time to pop round. Cheers.")).toBeNull();
    });
    it('8ac0c27f6b: leans on an unrecorded chat for what we will fit', () => {
        expect(detectSoftCommitment("Hiya MJ, got it. We'll fit the kit to the first sash window like we chatted.")).toBe('like we chatted');
    });

    it('each one now returns a soft_commitment violation from checkDraft', () => {
        for (const body of [
            "I'll get back to you shortly with the PM time for Craig's visit.",
            "What's the best time to schedule after your delivery on 2nd September?",
            "No stress, we'll attach it to your concrete floor.",
            "We'll fit the kit to the first sash window like we chatted.",
        ]) {
            expect(clean(body)?.code, body).toBe('soft_commitment');
        }
    });
});

describe('detectSoftCommitment — the near-misses that must stay fine', () => {
    it('a vague promise to ARRANGE a time is the office doing its job', () => {
        // guards-legacy-4fd756fb5c / 6c425868ce / c499576d1e, all labelled fine in the corpus.
        expect(detectSoftCommitment("We'll get a time sorted for someone to pop round and take a proper look at the brickwork and guttering before confirming anything.")).toBeNull();
        expect(detectSoftCommitment('Hi Carolyne, sorry for the delay, still getting a visit time sorted for you.')).toBeNull();
        expect(detectSoftCommitment("Once it's delivered and you're ready, we'll get a time booked in to come build it.")).toBeNull();
    });

    it('arranging a CALL is not arranging a visit', () => {
        // guards-incident-19427cd2ff, labelled unguarded_but_fine.
        expect(detectSoftCommitment("Cheers Lou, got it. We'll work around those pipes up there.\n---\nWhen would be a good time to call you?")).toBeNull();
    });

    it('outcome language with no method and no time stays fine', () => {
        for (const body of [
            "And with the bath leak, we'll get it fixed no problem.",                       // cd1196014b
            "We'll pop round and sort the gutter leak at the downpipe connection.",          // 7a8c7526aa
            "We'll pop round to 20 Nottingham Road and sort those out for you.",             // 9e831975c5
            "On it. We'll sort the quote for you now.",                                      // 83626d543e
            "Got your details. We'll have the quote over shortly.",                          // 7c8a242998
            "Right, cheers for letting me know, Jack. I'll get that quote sorted.",           // 217a122eef
        ]) {
            expect(detectSoftCommitment(body), body).toBeNull();
        }
    });

    it('ordinary scoping questions are untouched', () => {
        for (const body of [
            'Can you describe where you think the bath leak is coming from?',
            'Quick one - what type of recliner chair is it and what happens when you try to recline it?',
            'Quick one - are both jobs at the same property?',
            "Quick one - what's the property address for the quote?",
            'Quick one - could you send over some photos of the ceiling cracks?',
            'Quick one - is there any existing insulation that needs removing first?',
        ]) {
            expect(detectSoftCommitment(body), body).toBeNull();
        }
    });

    it('"I am" is not a time window', () => {
        expect(detectSoftCommitment('I am on it, the quote will follow.')).toBeNull();
        expect(detectSoftCommitment('I am arranging that visit now.')).toBeNull();
    });

    it('empty input is never a commitment', () => {
        for (const body of ['', '   ', '\n']) expect(detectSoftCommitment(body)).toBeNull();
    });
});

describe('where it sits in the chain', () => {
    it('a body that also carries a price is still refused as money first', () => {
        expect(clean("We'll attach it to your concrete floor for £200.")?.code).toBe('money_figure');
    });
    it('a body that also names a weekday is still refused as a date promise first', () => {
        expect(clean("Craig will be with you Thursday in the PM slot.")?.code).toBe('date_promise');
    });
    it('a clean reply that points at the quote passes', () => {
        expect(clean("The slots are all on your quote, pick whichever suits and it books itself.")).toBeNull();
    });
});
