import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
async function main(){
  const [q]=await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug,'tstprev1'));
  console.log(JSON.stringify({status:(q as any).status, createdAt:(q as any).createdAt, expiresAt:(q as any).expiresAt},null,2));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
