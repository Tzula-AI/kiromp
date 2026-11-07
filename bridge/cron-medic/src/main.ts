import { postmortem } from "@oh-my-pi/pi-utils";
import { loadConfig } from "./config.js";
import { Medic } from "./medic.js";

const medic = new Medic(loadConfig());
medic.start();

// Importing the omp SDK installs its own SIGTERM/SIGINT/SIGHUP handlers
// (pi-utils postmortem), which run registered cleanups and then exit
// (143 on SIGTERM). Shutdown therefore goes through a cleanup registration;
// the deadline covers aborting a running fix and writing its run file.
postmortem.register("kirocrew-cron-medic", (reason) => medic.stop(reason), { deadlineMs: 45_000 });
