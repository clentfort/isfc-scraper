import { DateTime, Interval } from "luxon";
import fs from "node:fs";
import PQueue from "p-queue";

const queue = new PQueue({ concurrency: 20 });

let pending = 0;
let active = 0;
let total = 0;
let completed = 0;

queue.on("add", () => {
  total += 1;
  pending += 1;
});

queue.on("active", () => {
  active += 1;
  pending -= 1;
});

queue.on("completed", () => {
  active -= 1;
  completed += 1;
});

let i = setInterval(() => {
  console.log(`Active: ${active}, Pending: ${pending}, Completed: ${completed}, Total: ${total}`);
}, 1000);

//
// const response = await fetch("https://components.ifsc-climbing.org/api/v1/season_leagues/418");
// const seasons = await response.json();
//
async function fetchEvents(league) {
  try {
    const leagueResponse = await queue.add(() => fetch(`https://components.ifsc-climbing.org/results-api.php?api=season_leagues_results&league=${league.id}`));
    const { events } = await leagueResponse.json();

    return await Promise.all(
      events.map(async (event) => {
        const { url, local_start_date, local_end_date, timezone: tz, ...rest } = event;
        let timezone = "";
        if (tz) {
          timezone = tz.value;
        }

        const [, id] = url.match(/\api\/v1\/events\/(\d+)/);
        const start = DateTime.fromISO(local_start_date);
        start.setZone(timezone);
        const end = DateTime.fromISO(local_end_date);
        end.setZone(timezone);
        const time = Interval.fromDateTimes(start, end);
        const e = { ...rest, time, id };

        await fetchEvent(e);
        return e;
      })
    );
  } catch {
    return null;
  }
}

async function fetchEventResults(fullResultsUrl) {
  try {
    const resultsResponse = await queue.add(() => fetch(`https://components.ifsc-climbing.org/results-api.php?api=event_full_results&result_url=${fullResultsUrl}`));
    return resultsResponse.json();
  } catch {
    return null;
  }
}

async function fetchEvent(event) {
  try {
    const eventResponse = await queue.add(() => fetch(`https://components.ifsc-climbing.org/results-api.php?api=event_results&event_id=${event.id}`));
    const { public_information: meta, d_cats: categories } = await eventResponse.json();

    const results = await Promise.all(
      categories.map(async ({ dcat_name: name, discipline_kind: discipline, category_name: category, full_results_url: fullResultsUrl }) => {
        const rankings = await fetchEventResults(fullResultsUrl);
        return {
          name,
          discipline,
          category,
          rankings,
        };
      })
    );
    event.meta = meta;
    event.results = results;
  } catch {
    return [];
  }
}

const seasonsResponse = await queue.add(() => fetch("https://components.ifsc-climbing.org/results-api.php?api=index"));
const { seasons } = await seasonsResponse.json();

const data = Promise.all(
  seasons.map(async ({ leagues, ...rest }) => {
    const l = await Promise.all(
      leagues.map((league) => {
        return fetchEvents(league);
      })
    );

    return { leagues: l, ...rest };
  })
);

queue.on("idle", () => {
  clearInterval(i);
});

data.then((d) => {
  console.log("writing data");
  fs.writeFileSync("./data.json", JSON.stringify(d, null, 2));
});

// const d = await fetchEvent({ id: 1291 });
// console.log(d.results[0].rankings);
