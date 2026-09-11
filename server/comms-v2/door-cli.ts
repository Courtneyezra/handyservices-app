/**
 * `npm run comms-v2:door`: serve the desk's sandbox door on a loopback port until interrupted,
 * so the pipeline's end-to-end test step, a script or Ben's sandbox can drive it over HTTP.
 *
 *   npm run comms-v2:door                 any free port; the URL is printed once
 *   npm run comms-v2:door -- --port 4747  a fixed port
 *
 * Environment: the ordinary process environment (a pipeline run copy inherits it through direnv;
 * a developer's shell carries it). The door connects only to the branch named by
 * COMMS_V2_DATABASE_URL and refuses production; DATABASE_URL is never read. No variable's value
 * is printed: only names, the address and the exit reason.
 */
import { openDoorHost } from './desk/door-host';

function parseArgs(argv: readonly string[]): { port: number } {
    const a = { port: 0 };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--port') {
            const v = Number(argv[++i]);
            if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error('--port needs a whole number between 0 and 65535');
            a.port = v;
        } else throw new Error(`unknown argument ${k}`);
    }
    return a;
}

export async function main(argv: readonly string[]): Promise<number> {
    const args = parseArgs(argv);
    let host;
    try {
        host = await openDoorHost({ port: args.port });
    } catch (err: any) {
        console.error(`ERROR: the door could not be opened: ${err?.message ?? err}`);
        return 1;
    }
    console.log(`door: ${host.url} (database from ${host.databaseFrom})`);
    console.log('serving until interrupted');
    await new Promise<void>((resolve) => {
        const stop = () => { host.close().then(resolve, resolve); };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
    });
    console.log('door closed');
    return 0;
}

const isEntry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isEntry) {
    main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(`ERROR: ${err?.message ?? err}`); process.exit(1); });
}
