import rimrafSync = require('rimraf');
import { promisify } from 'util';

export const rimraf = promisify(rimrafSync);
