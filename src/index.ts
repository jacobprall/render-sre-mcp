#!/usr/bin/env node

import { loadConfig } from './config.js';
import { startHttp } from './transport/http.js';
import { startStdio } from './transport/stdio.js';

const config = loadConfig();
if (config.port != null) {
  startHttp(config.port);
} else {
  startStdio();
}
