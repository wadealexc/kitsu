import chalk from 'chalk';
import bytes from 'bytes';

import { browserInit, type SearchRequest, type SearchResponse } from './browser/browser.js';
import { readConfig } from './config.js';

const CONFIG_PATH = './config.json';
const cfg = readConfig(CONFIG_PATH);

// Start web browser/search manager
const browser = await browserInit(cfg.braveAPIKey);

let urls = [
    'https://en.wikipedia.org/wiki/Cristiano_Ronaldo',
    'https://www.accuweather.com/en/us/atlanta/30303/weather-forecast/348181',
    'https://wiki.cavesofqud.com/index.php?title=Eaters%27_nectar_injector&mobileaction=toggle_view_desktop',
    'https://en.wikipedia.org/wiki/Don_Bal%C3%B3n',
    'https://hades.fandom.com/wiki/Zeus/Boons_(Hades_II)',
    'https://www.reddit.com/r/leagueoflegends/comments/1oshrk9/kt_rolster_vs_t1_2025_world_championship_final/',
    'https://www.nytimes.com/2025/11/19/us/politics/trumps-tariffs-trade-data.html',
    'https://news.ycombinator.com/',
    'https://news.ycombinator.com/item?id=45980005',
    'https://www.proxmox.com/en/about/company-details/press-releases/proxmox-virtual-environment-9-1'
].map(url => new URL(url));

const results = await Promise.allSettled(browser.fetchContent(...urls));

console.log(`all settled! results:`);
for (const result of results) {
    if (result.status === 'fulfilled') {
        console.log(chalk.dim.green(`got ${bytes(result.value.content.length)} from ${result.value.metadata.source}`));
    } else {
        console.log(chalk.dim.red(`failed to load: ${result.reason}`));
    }
}

// // wait for tasks to finish
// await new Promise<void>((resolve) => {
//     browser.once('done', resolve);
// });

// await new Promise<void>((resolve) => {
//     setTimeout(resolve, 40000);
// })

// console.log('okay, new pages!');

// urls = [
//     'https://github.com/wadealexc/llama-shim'
// ].map(url => new URL(url));

// browser.fetchContent(...urls);

// // wait for tasks to finish
// await new Promise<void>((resolve) => {
//     browser.once('done', resolve);
// });

await browser.shutdown();

// url = new URL('https://en.wikipedia.org/wiki/Cristiano_Ronaldo')
// browser.createTasks(url);

// // wait for tasks to finish
// await new Promise<void>((resolve) => {
//     browser.once('done', resolve);
// });

// setTimeout(async () => {
//     console.log(`timeout reached; shutting down`)
//     await browser.shutdown();
// }, 30000)

// await browser.shutdown();
// process.exit(0);