import csv from 'csv-parser';
import { createReadStream, readFileSync } from 'fs';
import { safeLoad as parseYAML } from 'js-yaml';
import * as ast from 'pg-ast';
import {
  makeBoundingBox,
  makeLocation,
  getRelatedField,
  wrapValue
} from './utils';

export const parse = (path, opts) =>
  new Promise((resolve, reject) => {
    const results = [];
    createReadStream(path)
      .pipe(csv(opts))
      // TODO check if 'data' is guaranteed to have a full row,
      // if so, make a hook to use the stream properly
      .on('data', (data) => results.push(data))
      .on('error', (er) => {
        reject(er);
      })
      .on('end', () => {
        resolve(results);
      });
  });

export const readConfig = (config) => {
  let configValue;
  if (config.endsWith('.js')) {
    configValue = require(config);
  } else if (config.endsWith('json')) {
    configValue = JSON.parse(readFileSync(config, 'utf-8'));
  } else if (config.endsWith('yaml') || config.endsWith('yml')) {
    configValue = parseYAML(readFileSync(config, 'utf-8'));
  } else {
    throw new Error('unsupported config!');
  }
  return configValue;
};

const getFromValue = (from) => {
  if (Array.isArray(from)) return from;
  return [from];
};

const getValuesFromKeys = (object, keys) => keys.map((key) => object[key]);

// type (int, text, etc)
// from Array of keys that map to records found (e.g., ['lon', 'lat'])
const getCoercionFunc = (type, from, opts) => {
  switch (type) {
    case 'int':
      return (record) => {
        const val = ast.A_Const({
          val: ast.Integer({ ival: record[from[0]] })
        });
        return wrapValue(val, opts);
      };
    case 'float':
      return (record) => {
        const val = ast.A_Const({ val: ast.Float({ str: record[from[0]] }) });
        return wrapValue(val, opts);
      };
    case 'bbox':
      // do bbox magic with args from the fields
      return (record) => {
        const val = makeBoundingBox(record[from[0]]);
        return wrapValue(val, opts);
      };
    case 'location':
      return (record) => {
        const [lon, lat] = getValuesFromKeys(record, from);
        const val = makeLocation(lon, lat);
        return wrapValue(val, opts);
      };
    case 'related':
      return (record) => {
        return getRelatedField({
          ...opts,
          record,
          from
        });
      };
    case 'text':
    default:
      return (record) => {
        const val = ast.A_Const({ val: ast.String({ str: record[from[0]] }) });
        return wrapValue(val, opts);
      };
  }
};

export const parseTypes = (config) => {
  return Object.entries(config.fields).reduce((m, v) => {
    const [key, value] = v;
    let type;
    let from;
    if (typeof value === 'string') {
      type = value;
      from = [key];
      if (['related', 'location'].includes(type)) {
        throw new Error('must use object for ' + type + ' type');
      }
    } else {
      type = value.type;
      from = getFromValue(value.from || key);
    }
    m[key] = getCoercionFunc(type, from, value);
    return m;
  }, {});
};
