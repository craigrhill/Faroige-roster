// netlify/src/foroige.mjs
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
var base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
var base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
var getEnvironment = () => {
  const { Deno, Netlify, process: process2 } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process2?.env[key],
    get: (key) => process2?.env[key],
    has: (key) => Boolean(process2?.env[key]),
    set: (key, value) => {
      if (process2?.env) {
        process2.env[key] = value;
      }
    },
    toObject: () => process2?.env ?? {}
  };
};

// node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => {
  return globalThis[GET_TRACER]?.(name, version);
};
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}

// node_modules/@netlify/blobs/dist/chunk-6TDSNTDP.js
var getEnvironmentContext = () => {
  const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context !== "string" || !context) {
    return {};
  }
  const data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    );
    this.name = "MissingBlobsEnvironmentError";
  }
};
var BASE64_PREFIX = "b64;";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var METADATA_MAX_SIZE = 2 * 1024;
var encodeMetadata = (metadata) => {
  if (!metadata) {
    return null;
  }
  const encodedObject = base64Encode(JSON.stringify(metadata));
  const payload = `b64;${encodedObject}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
    throw new Error("Metadata object exceeds the maximum size");
  }
  return payload;
};
var decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX)) {
    return {};
  }
  const encodedData = header.slice(BASE64_PREFIX.length);
  const decodedData = base64Decode(encodedData);
  const metadata = JSON.parse(decodedData);
  return metadata;
};
var getMetadataFromResponse = (response) => {
  if (!response.headers) {
    return {};
  }
  const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
};
var NF_ERROR = "x-nf-error";
var NF_REQUEST_ID = "x-nf-request-id";
var DEPLOY_STORE_PREFIX = "deploy:";
var SITE_STORE_PREFIX = "site:";
var isDeniedWrite = (res, { method, storeName }) => (res.status === 401 || res.status === 403) && (method === "put" || method === "delete") && storeName !== void 0 && !storeName.startsWith(DEPLOY_STORE_PREFIX);
var blobsErrorMessage = (res, context, responseBody) => {
  let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
  if (res.headers.has(NF_REQUEST_ID)) {
    details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
  }
  if (isDeniedWrite(res, context)) {
    const storeName = context.storeName?.startsWith(SITE_STORE_PREFIX) ? context.storeName.slice(SITE_STORE_PREFIX.length) : context.storeName;
    return `Netlify Blobs could not write to store '${storeName}' (${details}). Builds and build plugins can only write to deploy-specific stores: use 'getDeployStore' instead of 'getStore', or pass a 'token' with write access to the store. If this code is not running in a build, check that the token and site ID are valid. See https://docs.netlify.com/build/data-and-storage/netlify-blobs/#deploy-specific-stores`;
  }
  let message = `Netlify Blobs has generated an internal error (${details})`;
  if (!res.headers.get(NF_ERROR) && responseBody) {
    message += `: ${responseBody}`;
  }
  return message;
};
var BlobsInternalError = class extends Error {
  constructor(res, context = {}, responseBody) {
    super(blobsErrorMessage(res, context, responseBody));
    this.name = "BlobsInternalError";
    this.status = res.status;
    this.responseBody = responseBody;
  }
};
var createBlobsInternalError = async (res, context = {}) => {
  const responseBody = await res.clone().text().catch(() => void 0);
  return new BlobsInternalError(res, context, responseBody);
};
var collectIterator = async (iterator) => {
  const result = [];
  for await (const item of iterator) {
    result.push(item);
  }
  return result;
};
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
    );
    this.name = "BlobsConsistencyError";
  }
};
var regions = {
  "us-east-1": true,
  "us-east-2": true,
  "eu-central-1": true,
  "ap-southeast-1": true,
  "ap-southeast-2": true
};
var isValidRegion = (input) => Object.keys(regions).includes(input);
var InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    );
    this.name = "InvalidBlobsRegionError";
  }
};
var DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
var MIN_RETRY_DELAY = 1e3;
var MAX_RETRY = 5;
var RATE_LIMIT_HEADER = "X-RateLimit-Reset";
var fetchAndRetry = async (fetch, url, options, attemptsLeft = MAX_RETRY, getRetryUrl) => {
  try {
    const res = await fetch(url, options);
    const isRetryable = res.status === 429 || res.status >= 500 || getRetryUrl !== void 0 && res.status === 403;
    if (attemptsLeft > 0 && isRetryable) {
      const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      const retryUrl = getRetryUrl ? await getRetryUrl() : url;
      return fetchAndRetry(fetch, retryUrl, options, attemptsLeft - 1, getRetryUrl);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0) {
      throw error;
    }
    const delay = getDelay();
    await sleep(delay);
    const retryUrl = getRetryUrl ? await getRetryUrl() : url;
    return fetchAndRetry(fetch, retryUrl, options, attemptsLeft - 1, getRetryUrl);
  }
};
var getDelay = (rateLimitReset) => {
  if (!rateLimitReset) {
    return DEFAULT_RETRY_DELAY;
  }
  return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
};
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
var Client = class {
  constructor({ apiURL, consistency, edgeURL, fetch, region, siteID, token, uncachedEdgeURL }) {
    this.apiURL = apiURL;
    this.consistency = consistency ?? "eventual";
    this.edgeURL = edgeURL;
    this.fetch = fetch ?? globalThis.fetch;
    this.region = region;
    this.siteID = siteID;
    this.token = token;
    this.uncachedEdgeURL = uncachedEdgeURL;
    if (!this.fetch) {
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
    }
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    const encodedMetadata = encodeMetadata(metadata);
    const consistency = opConsistency ?? this.consistency;
    let urlPath = `/${this.siteID}`;
    if (storeName) {
      urlPath += `/${storeName}`;
    }
    if (key) {
      urlPath += `/${key}`;
    }
    if (this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL) {
        throw new BlobsConsistencyError();
      }
      const headers2 = {
        authorization: `Bearer ${this.token}`
      };
      if (encodedMetadata) {
        headers2[METADATA_HEADER_INTERNAL] = encodedMetadata;
      }
      if (this.region) {
        urlPath = `/region:${this.region}${urlPath}`;
      }
      const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (const key2 in parameters) {
        url2.searchParams.set(key2, parameters[key2]);
      }
      return {
        headers: headers2,
        url: url2.toString()
      };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (const key2 in parameters) {
      url.searchParams.set(key2, parameters[key2]);
    }
    if (this.region) {
      url.searchParams.set("region", this.region);
    }
    if (storeName === void 0 || key === void 0) {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    if (encodedMetadata) {
      apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
    }
    if (method === "head" || method === "delete") {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    const res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200) {
      throw await createBlobsInternalError(res, { method, storeName });
    }
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
    return {
      headers: userHeaders,
      url: signedURL
    };
  }
  async makeRequest({
    body: body2,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    });
    const headers2 = {
      ...baseHeaders,
      ...extraHeaders
    };
    if (method === "put") {
      headers2["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
      headers2["if-match"] = conditions.onlyIfMatch;
    } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
      headers2["if-none-match"] = "*";
    }
    const options = {
      body: body2,
      headers: headers2,
      method
    };
    if (body2 instanceof ReadableStream) {
      options.duplex = "half";
    }
    const usesSignedUrl = !this.edgeURL && key !== void 0 && storeName !== void 0 && method !== "head" && method !== "delete";
    let getRetryUrl;
    if (usesSignedUrl) {
      getRetryUrl = async () => {
        const finalRequest = await this.getFinalRequest({ consistency, key, metadata, method, parameters, storeName });
        return finalRequest.url;
      };
    }
    return fetchAndRetry(this.fetch, url, options, void 0, getRetryUrl);
  }
};
var getClientOptions = (options, contextOverride) => {
  const context = contextOverride ?? getEnvironmentContext();
  const siteID = context.siteID ?? options.siteID;
  const token = context.token ?? options.token;
  if (!siteID || !token) {
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  }
  if (options.region !== void 0 && !isValidRegion(options.region)) {
    throw new InvalidBlobsRegionError(options.region);
  }
  const clientOptions = {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
  return clientOptions;
};

// node_modules/@netlify/blobs/dist/main.js
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
var STATUS_OK = 200;
var STATUS_PRE_CONDITION_FAILED = 412;
var Store = class _Store {
  constructor(options) {
    this.client = options.client;
    if ("deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      if (options.name) {
        name += `:${options.name}`;
      }
      this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName);
      this.name = storeName;
    } else {
      _Store.validateStoreName(options.name);
      this.name = SITE_STORE_PREFIX + options.name;
    }
  }
  async delete(key) {
    const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status)) {
      throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
    }
  }
  async deleteAll() {
    let totalDeletedBlobs = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200) {
        throw new BlobsInternalError(res, { method: "delete", storeName: this.name });
      }
      const data = await res.json();
      if (typeof data.blobs_deleted !== "number") {
        throw new BlobsInternalError(res);
      }
      totalDeletedBlobs += data.blobs_deleted;
      hasMore = typeof data.has_more === "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      const { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      const res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      if (type === void 0 || type === "text") {
        return res.text();
      }
      if (type === "arrayBuffer") {
        return res.arrayBuffer();
      }
      if (type === "blob") {
        return res.blob();
      }
      if (type === "json") {
        return res.json();
      }
      if (type === "stream") {
        return res.body;
      }
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      const res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const etag = res?.headers.get("etag") ?? void 0;
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag,
        metadata
      };
      return result;
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      const { consistency, etag: requestETag, type } = options ?? {};
      const headers2 = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      const res = await this.client.makeRequest({
        consistency,
        headers: headers2,
        key,
        method: "get",
        storeName: this.name
      });
      const responseETag = res?.headers.get("etag") ?? void 0;
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag) {
        return { data: null, ...result };
      }
      if (type === void 0 || type === "text") {
        return { data: await res.text(), ...result };
      }
      if (type === "arrayBuffer") {
        return { data: await res.arrayBuffer(), ...result };
      }
      if (type === "blob") {
        return { data: await res.blob(), ...result };
      }
      if (type === "json") {
        return { data: await res.json(), ...result };
      }
      if (type === "stream") {
        return { data: res.body, ...result };
      }
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? false
      });
      const iterator = this.getListIterator(options);
      if (options.paginate) {
        return iterator;
      }
      return collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw await createBlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const payload = JSON.stringify(data);
      const headers2 = {
        "content-type": "application/json"
      };
      const res = await this.client.makeRequest({
        conditions,
        body: payload,
        headers: headers2,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res, { method: "put", storeName: this.name });
    });
  }
  static formatListResultBlob(result) {
    if (!result.key) {
      return null;
    }
    return {
      etag: result.etag,
      key: result.key
    };
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options) {
      throw new Error(
        `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
      );
    }
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch !== "string") {
        throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
      }
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew !== "boolean") {
        throw new Error(
          `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
        );
      }
      return {
        onlyIfNew: true
      };
    }
  }
  static validateKey(key) {
    if (key === "") {
      throw new Error("Blob key must not be empty.");
    }
    if (key.startsWith("/") || key.startsWith("%2F")) {
      throw new Error("Blob key must not start with forward slash (/).");
    }
    if (new TextEncoder().encode(key).length > 600) {
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
    }
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID)) {
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
    }
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F")) {
      throw new Error("Store name must not contain forward slashes (/).");
    }
    if (new TextEncoder().encode(name).length > 64) {
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
    }
  }
  getListIterator(options) {
    const { client, name: storeName } = this;
    const parameters = {};
    if (options?.prefix) {
      parameters.prefix = options.prefix;
    }
    if (options?.directories) {
      parameters.directories = "true";
    }
    return {
      [Symbol.asyncIterator]() {
        let currentCursor = null;
        let done = false;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? false,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              });
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [];
              let directories = [];
              if (![200, 204, 404].includes(res.status)) {
                throw new BlobsInternalError(res);
              }
              if (res.status === 404) {
                done = true;
              } else {
                const page = await res.json();
                if (page.next_cursor) {
                  currentCursor = page.next_cursor;
                } else {
                  done = true;
                }
                blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                directories = page.directories ?? [];
              }
              return {
                done: false,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
};
var getStore = (input, options) => {
  if (typeof input === "string") {
    const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
    const clientOptions = getClientOptions(options ?? {}, contextOverride);
    const client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name === "string") {
    const { name } = input;
    const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
    const clientOptions = getClientOptions(input, contextOverride);
    if (!name) {
      throw new MissingBlobsEnvironmentError(["name"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID === "string") {
    const clientOptions = getClientOptions(input);
    const { deployID } = input;
    if (!deployID) {
      throw new MissingBlobsEnvironmentError(["deployID"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};

// netlify/src/foroige.mjs
var STORE = "foroige";
var TOKEN_DAYS = 365;
var DEFAULT_REQUIRED = 3;
var DEFAULT_REQUIRED_TRAINED = 1;
var DEFAULT_REQUIRED_TRAINED_EVENTS = 0;
var MAX_BULK = 100;
var ADMIN_TRIES = 5;
var ADMIN_LOCKS = [1, 5, 15];
var headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password, x-rota-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
var json = (status, body2) => new Response(JSON.stringify(body2), { status, headers });
var fail = (status, error) => json(status, { error });
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
var adminPw = () => (process.env.ADMIN_PASSWORD || "").trim();
function adminOk(req) {
  const envPw = adminPw();
  if (!envPw) return false;
  return safeEqual((req.headers.get("x-admin-password") || "").trim(), envPw);
}
async function readDoc(store, key, fallback) {
  const r = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  return r && r.data ? { doc: r.data, etag: r.etag } : { doc: fallback(), etag: null };
}
async function update(store, key, fallback, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { doc, etag } = await readDoc(store, key, fallback);
    const next = fn(doc);
    if (next === false) return doc;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const r = await store.set(key, JSON.stringify(next), etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (r.modified !== false) return next;
  }
  throw new Error("Someone else saved at the same moment. Try again.");
}
var secrets = /* @__PURE__ */ new WeakMap();
async function secret(store) {
  if (secrets.has(store)) return secrets.get(store);
  const r = await store.getWithMetadata("secret", { type: "text", consistency: "strong" });
  let s = r && r.data;
  if (!s) {
    s = randomBytes(32).toString("hex");
    const w = await store.set("secret", s, { onlyIfNew: true });
    if (w.modified === false) s = (await store.getWithMetadata("secret", { type: "text", consistency: "strong" })).data;
  }
  secrets.set(store, s);
  return s;
}
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const b = randomBytes(8);
  let c = "";
  for (let i = 0; i < 8; i++) c += ALPHABET[b[i] & 31];
  return c.slice(0, 4) + "-" + c.slice(4);
}
var normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
var hmac = (sec, s, enc) => createHmac("sha256", Buffer.from(sec, "hex")).update(s).digest(enc);
var codeHash = (sec, code) => hmac(sec, normCode(code), "hex");
function issueToken(sec, id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + TOKEN_DAYS * 864e5 })).toString("base64url");
  return payload + "." + hmac(sec, payload, "base64url");
}
function readToken(sec, token) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = hmac(sec, payload, "base64url");
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return j.id && j.exp > Date.now() ? j : null;
  } catch {
    return null;
  }
}
var rosterFallback = () => ({ people: [] });
var calendarFallback = () => ({ entries: [] });
var MAX_ENTRIES = 200;
var isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00Z"));
var clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
var sectionFallback = () => ({ required: DEFAULT_REQUIRED, requiredTrained: DEFAULT_REQUIRED_TRAINED, requiredTrainedEvents: DEFAULT_REQUIRED_TRAINED_EVENTS, slots: {} });
var pub = (p) => ({ id: p.id, name: p.name, sections: p.sections || [], trained: !!p.trained, secretary: !!p.secretary });
var isKey = (k) => typeof k === "string" && /^[a-z0-9-]{1,32}$/.test(k);
var isSlotId = (s) => typeof s === "string" && /^[me]:(\d{4}-\d{2}-\d{2}(:.{1,140})?|[a-f0-9]{8,32})$/.test(s);
var cleanName = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 60);
var cleanSections = (a) => Array.isArray(a) ? [...new Set(a.filter(isKey))] : [];
var num = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
};
var optNum = (v) => v === null || v === void 0 || v === "" ? null : num(v);
async function body(req) {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}
function makePerson(b, sec, code) {
  return {
    id: randomBytes(4).toString("hex"),
    name: cleanName(b.name),
    sections: cleanSections(b.sections),
    trained: !!b.trained,
    secretary: !!b.secretary,
    codeHash: codeHash(sec, code),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createHandler(storeFactory) {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    const a = url.searchParams.get("a") || "";
    try {
      const store = storeFactory();
      const sec = await secret(store);
      if (req.method === "GET" && a === "public") {
        const k = url.searchParams.get("section") || "";
        if (!isKey(k)) return fail(400, "Bad club.");
        const [{ doc: sect }, { doc: cal }] = [await readDoc(store, "section/" + k, sectionFallback), await readDoc(store, "calendar", calendarFallback)];
        const people = (await readDoc(store, "roster", rosterFallback)).doc.people;
        const trainedIds = new Set(people.filter((p) => p.trained).map((p) => p.id));
        const known = new Set(people.map((p) => p.id));
        const entries = (cal.entries || []).map((e) => {
          const on = ((sect.slots[e.kind + ":" + e.id] || {}).who || []).filter((id) => known.has(id));
          return {
            kind: e.kind,
            date: e.date,
            endDate: e.endDate || null,
            title: e.title,
            location: e.location || "",
            details: e.details || "",
            off: !!e.off,
            need: e.need ?? null,
            needTrained: e.needTrained ?? null,
            on: on.length,
            trained: on.filter((id) => trainedIds.has(id)).length
          };
        });
        return json(200, {
          required: sect.required,
          requiredTrained: sect.requiredTrained ?? DEFAULT_REQUIRED_TRAINED,
          requiredTrainedEvents: sect.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS,
          entries
        });
      }
      if (req.method === "POST" && a === "admin-login") {
        if (!adminPw()) return fail(503, "No admin password is set for this site. Set ADMIN_PASSWORD in Netlify, scoped to Functions, then redeploy.");
        const guard = await readDoc(store, "admin-tries", () => ({ fails: 0, until: 0, locks: 0 }));
        const waitMs = (guard.doc.until || 0) - Date.now();
        if (waitMs > 0) return fail(429, `Too many wrong tries. Signing in is shut for another ${Math.ceil(waitMs / 6e4)} minute${Math.ceil(waitMs / 6e4) === 1 ? "" : "s"}.`);
        if (!adminOk(req)) {
          await update(store, "admin-tries", () => ({ fails: 0, until: 0, locks: 0 }), (d) => {
            d.fails = (d.fails || 0) + 1;
            if (d.fails >= ADMIN_TRIES) {
              d.until = Date.now() + ADMIN_LOCKS[Math.min(d.locks || 0, ADMIN_LOCKS.length - 1)] * 6e4;
              d.locks = (d.locks || 0) + 1;
              d.fails = 0;
            }
            return d;
          });
          await new Promise((r) => setTimeout(r, 250));
          return fail(401, "Wrong password.");
        }
        await update(store, "admin-tries", () => ({ fails: 0, until: 0, locks: 0 }), (d) => d.fails || d.until || d.locks ? { fails: 0, until: 0, locks: 0 } : false);
        const b2 = await body(req);
        const name = cleanName(b2 && b2.name);
        if (!name) return fail(400, "A name is needed.");
        let person, created = false;
        await update(store, "roster", rosterFallback, (doc) => {
          person = doc.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
          const sections = cleanSections(b2 && b2.sections);
          if (person) {
            const already = person.secretary && !sections.some((k) => !(person.sections || []).includes(k));
            person.secretary = true;
            if (sections.length) person.sections = [.../* @__PURE__ */ new Set([...person.sections || [], ...sections])];
            if (already) return false;
          } else {
            created = true;
            person = makePerson({ name, sections, secretary: true }, sec, newCode());
            doc.people.push(person);
          }
          return doc;
        });
        return json(200, { token: issueToken(sec, person.id), me: pub(person), created });
      }
      if (req.method === "POST" && a === "login") {
        const b2 = await body(req);
        const h = codeHash(sec, b2 && b2.code);
        const { doc } = await readDoc(store, "roster", rosterFallback);
        const person = doc.people.find((p) => p.codeHash === h);
        if (!person || normCode(b2.code).length < 8) {
          await new Promise((r) => setTimeout(r, 250));
          return fail(401, "That code is not recognised.");
        }
        return json(200, { token: issueToken(sec, person.id), me: pub(person) });
      }
      const t = readToken(sec, req.headers.get("x-rota-token"));
      if (!t) return fail(401, "Please sign in.");
      const roster = await readDoc(store, "roster", rosterFallback);
      const me = roster.doc.people.find((p) => p.id === t.id);
      if (!me) return fail(401, "Please sign in.");
      const canManage = !!me.secretary;
      if (req.method === "GET") {
        const keys = (url.searchParams.get("sections") || "").split(",").map((s) => s.trim()).filter(isKey);
        const sections = {};
        for (const k of keys) {
          const { doc } = await readDoc(store, "section/" + k, sectionFallback);
          sections[k] = {
            required: doc.required,
            requiredTrained: doc.requiredTrained ?? DEFAULT_REQUIRED_TRAINED,
            requiredTrainedEvents: doc.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS,
            slots: doc.slots,
            updatedAt: doc.updatedAt || null
          };
        }
        const mine = new Set(me.sections || []);
        const visible = canManage ? roster.doc.people : roster.doc.people.filter((p) => p.id === me.id || (p.sections || []).some((k) => mine.has(k)));
        const cal = await readDoc(store, "calendar", calendarFallback);
        return json(200, { me: pub(me), people: visible.map(pub), sections, calendar: { entries: cal.doc.entries || [], updatedAt: cal.doc.updatedAt || null } });
      }
      if (req.method !== "POST") return fail(405, "Method not allowed.");
      const b = await body(req);
      if (!b) return fail(400, "Body must be JSON.");
      if (a === "slot") {
        if (!isKey(b.section) || !isSlotId(b.id)) return fail(400, "Bad club or night.");
        const known = new Set(roster.doc.people.map((p) => p.id));
        const add = Array.isArray(b.add) ? b.add : [], remove = Array.isArray(b.remove) ? b.remove : [];
        if ([...add, ...remove].some((id) => !known.has(id))) return fail(400, "Unknown person.");
        if ("need" in b || "needTrained" in b || "off" in b) return fail(403, "Whether a night is on, and how many it needs, are set on the calendar by the coordinator.");
        const boss = canManage;
        if (!boss && [...add, ...remove].some((id) => id !== me.id)) return fail(403, "You can only put yourself on a night.");
        const cal = await readDoc(store, "calendar", calendarFallback);
        const entry = (cal.doc.entries || []).find((e) => b.id === e.kind + ":" + e.id) || {};
        const trainedIds = new Set(roster.doc.people.filter((p) => p.trained).map((p) => p.id));
        let refused = null;
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const s = d.slots[b.id] = d.slots[b.id] || { who: [] };
          if (!boss && add.includes(me.id) && !s.who.includes(me.id)) {
            const need = entry.need > 0 ? entry.need : d.required;
            const defT = b.id.startsWith("e:") ? d.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS : d.requiredTrained ?? DEFAULT_REQUIRED_TRAINED;
            const needT = Math.min(Number.isFinite(entry.needTrained) ? entry.needTrained : defT, need);
            const on = s.who.length, trained = s.who.filter((id) => trainedIds.has(id)).length;
            const held = Math.max(0, needT - trained);
            const ok = trainedIds.has(me.id) ? on < need || held > 0 : on < need - held;
            if (!ok) {
              refused = held > 0 && on < need ? "That night is full apart from a place held for someone with the training." : "That night is full. Ask the coordinator if you need to be on it.";
              return false;
            }
          }
          s.who = [.../* @__PURE__ */ new Set([...s.who.filter((id) => !remove.includes(id)), ...add])].filter((id) => known.has(id));
          return d;
        });
        if (refused) return fail(409, refused);
        return json(200, { section: doc });
      }
      if (!canManage) return fail(403, "Only the club coordinator can change that.");
      if (a === "required") {
        if (!isKey(b.section)) return fail(400, "Bad club.");
        const wantN = "required" in b ? num(b.required) : null;
        const wantT = "requiredTrained" in b ? num(b.requiredTrained) : null;
        const wantE = "requiredTrainedEvents" in b ? num(b.requiredTrainedEvents) : null;
        if (wantN !== null && !(wantN >= 1 && wantN <= 9)) return fail(400, "Leaders needed must be 1 to 9.");
        for (const v of [wantT, wantE]) if (v !== null && !(v >= 0 && v <= 9)) return fail(400, "Trained leaders needed must be 0 to 9.");
        const cur = await readDoc(store, "section/" + b.section, sectionFallback);
        const finalN = wantN ?? cur.doc.required;
        const finalT = wantT ?? (cur.doc.requiredTrained ?? DEFAULT_REQUIRED_TRAINED);
        const finalE = wantE ?? (cur.doc.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS);
        if (finalT > finalN || finalE > finalN) return fail(400, "You cannot need more trained leaders than leaders.");
        const doc = await update(store, "section/" + b.section, sectionFallback, (d) => {
          const required = wantN ?? d.required;
          const requiredTrained = wantT ?? (d.requiredTrained ?? DEFAULT_REQUIRED_TRAINED);
          const requiredTrainedEvents = wantE ?? (d.requiredTrainedEvents ?? DEFAULT_REQUIRED_TRAINED_EVENTS);
          if (requiredTrained > required || requiredTrainedEvents > required) return false;
          d.required = required;
          d.requiredTrained = requiredTrained;
          d.requiredTrainedEvents = requiredTrainedEvents;
          return d;
        });
        return json(200, { section: doc });
      }
      if (a === "calendar") {
        const rows = Array.isArray(b.entries) ? b.entries : null;
        if (!rows) return fail(400, "No calendar given.");
        if (rows.length > MAX_ENTRIES) return fail(400, `That is more than ${MAX_ENTRIES} nights.`);
        const entries = [];
        for (const row of rows) {
          if (!row || typeof row !== "object") return fail(400, "Every night needs a date and a name.");
          const kind = row.kind === "e" ? "e" : "m";
          if (!isDate(row.date)) return fail(400, "Every night needs a date, as 2026-10-09.");
          const title = clip(row.title, 80);
          if (!title) return fail(400, "Every night needs a name.");
          const endDate = isDate(row.endDate) && row.endDate > row.date ? row.endDate : null;
          const entry = {
            id: /^[a-f0-9]{8,32}$/.test(row.id || "") ? row.id : randomBytes(6).toString("hex"),
            kind,
            date: row.date,
            title,
            location: clip(row.location, 80),
            details: clip(row.details, 300)
          };
          if (endDate) entry.endDate = endDate;
          const need = optNum(row.need), needTrained = optNum(row.needTrained);
          if (need != null && need >= 1 && need <= 9) entry.need = need;
          if (needTrained != null && needTrained >= 0 && needTrained <= 9) entry.needTrained = needTrained;
          if (entry.need != null && entry.needTrained > entry.need) entry.needTrained = entry.need;
          if (row.off) entry.off = true;
          entries.push(entry);
        }
        if (new Set(entries.map((e) => e.id)).size !== entries.length) return fail(400, "The same night was sent twice.");
        entries.sort((x, y) => x.date.localeCompare(y.date) || x.title.localeCompare(y.title));
        const doc = await update(store, "calendar", calendarFallback, (d) => {
          d.entries = entries;
          return d;
        });
        return json(200, { calendar: { entries: doc.entries, updatedAt: doc.updatedAt } });
      }
      if (a === "person") {
        const name = cleanName(b.name);
        if (!name) return fail(400, "A name is needed.");
        const code = newCode();
        let person;
        await update(store, "roster", rosterFallback, (d) => {
          if (d.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) return false;
          person = makePerson({ ...b, name }, sec, code);
          d.people.push(person);
          return d;
        });
        if (!person) return fail(409, "Someone with that name is already on the list.");
        return json(200, { person: pub(person), code });
      }
      if (a === "people") {
        const rows = Array.isArray(b.people) ? b.people.slice(0, MAX_BULK) : null;
        if (!rows || !rows.length) return fail(400, "No names given.");
        const wanted = [];
        const seen = /* @__PURE__ */ new Set();
        for (const row of rows) {
          const name = cleanName(row && row.name);
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          wanted.push({ row: { ...row, name, secretary: false }, code: newCode() });
        }
        if (!wanted.length) return fail(400, "No usable names given.");
        const added = [], skipped = [];
        await update(store, "roster", rosterFallback, (d) => {
          added.length = 0;
          skipped.length = 0;
          const have = new Set(d.people.map((p) => p.name.toLowerCase()));
          for (const w of wanted) {
            if (have.has(w.row.name.toLowerCase())) {
              skipped.push(w.row.name);
              continue;
            }
            const person = makePerson(w.row, sec, w.code);
            d.people.push(person);
            have.add(w.row.name.toLowerCase());
            added.push({ person: pub(person), code: w.code });
          }
          return added.length ? d : false;
        });
        return json(200, { added, skipped });
      }
      if (a === "person-update" || a === "person-remove" || a === "recode") {
        const target = roster.doc.people.find((p) => p.id === b.id);
        if (!target) return fail(404, "No such person.");
        const secretaries = roster.doc.people.filter((p) => p.secretary).length;
        const losingSecretary = target.secretary && (a === "person-remove" || a === "person-update" && "secretary" in b && !b.secretary);
        if (losingSecretary && secretaries <= 1) return fail(409, "Keep at least one coordinator.");
        if (a === "recode") {
          const code = newCode();
          await update(store, "roster", rosterFallback, (d) => {
            const p = d.people.find((x) => x.id === b.id);
            if (!p) return false;
            p.codeHash = codeHash(sec, code);
            return d;
          });
          return json(200, { code });
        }
        if (a === "person-update") {
          let person;
          await update(store, "roster", rosterFallback, (d) => {
            person = d.people.find((x) => x.id === b.id);
            if (!person) return false;
            if ("name" in b) {
              const n = cleanName(b.name);
              if (n) person.name = n;
            }
            if ("sections" in b) person.sections = cleanSections(b.sections);
            if ("trained" in b) person.trained = !!b.trained;
            if ("secretary" in b) person.secretary = !!b.secretary;
            return d;
          });
          return json(200, { person: pub(person) });
        }
        const doc = await update(store, "roster", rosterFallback, (d) => {
          d.people = d.people.filter((x) => x.id !== b.id);
          return d;
        });
        for (const k of cleanSections(b.sections)) {
          await update(store, "section/" + k, sectionFallback, (d) => {
            let hit = false;
            for (const s of Object.values(d.slots)) {
              const n = s.who.length;
              s.who = s.who.filter((id) => id !== b.id);
              if (s.who.length !== n) hit = true;
            }
            return hit ? d : false;
          });
        }
        return json(200, { people: doc.people.map(pub) });
      }
      return fail(400, "Unknown action.");
    } catch (e) {
      return fail(500, String(e.message || e));
    }
  };
}
function memoryStore() {
  const m = /* @__PURE__ */ new Map();
  return {
    _map: m,
    async getWithMetadata(key, opts = {}) {
      const e = m.get(key);
      if (!e) return null;
      return { data: opts.type === "json" ? JSON.parse(e.value) : e.value, etag: e.etag, metadata: {} };
    },
    async set(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = randomBytes(6).toString("hex");
      m.set(key, { value: String(value), etag });
      return { etag, modified: true };
    }
  };
}
var foroige_default = createHandler(() => getStore(STORE));
export {
  createHandler,
  foroige_default as default,
  memoryStore
};
