// Release bootstrap: use the user's existing Pi state and Vika secrets policy.
// Do not copy credentials into the release or invent another secrets parser.
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const home = process.env.USERPROFILE || os.homedir();
process.env.HOME = home;
await import(pathToFileURL(path.join(home, '.vika', 'current', 'scripts', 'windows-launch.mjs')).href);
