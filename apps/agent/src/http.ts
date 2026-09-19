import dns, { Resolver } from "node:dns";
import { resolve4 } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";

export type DiscoveryHttpResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type DiscoveryRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

const RECURSIVE_DNS = ["1.1.1.1", "8.8.8.8"];
const CF_NS_HOSTS = ["kevin.ns.cloudflare.com", "marjory.ns.cloudflare.com"];

const resolveWith = (resolver: Resolver, hostname: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    resolver.resolve4(hostname, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(addresses);
    });
  });
};

const resolveViaServers = async (servers: string[], hostname: string): Promise<string[]> => {
  const resolver = new Resolver();
  resolver.setServers(servers);
  const fqdn = hostname.endsWith(".") ? hostname : `${hostname}.`;
  return resolveWith(resolver, fqdn);
};

let cloudflareNsIps: string[] | undefined;

const cloudflareNs = async (): Promise<string[]> => {
  if (cloudflareNsIps && cloudflareNsIps.length > 0) {
    return cloudflareNsIps;
  }
  const ips: string[] = [];
  for (const host of CF_NS_HOSTS) {
    try {
      const found = await resolveViaServers(RECURSIVE_DNS, host);
      ips.push(...found);
    } catch {
      // try the next nameserver hostname
    }
  }
  if (ips.length === 0) {
    throw new Error("could not resolve Cloudflare nameservers");
  }
  cloudflareNsIps = ips.slice(0, 4);
  return cloudflareNsIps;
};

export const resolveHostname = async (hostname: string): Promise<string[]> => {
  if (hostname === "localhost") {
    return ["127.0.0.1"];
  }
  if (isIP(hostname) === 4) {
    return [hostname];
  }
  const fromCloudflareNs = async (): Promise<string[]> => {
    const ns = await cloudflareNs();
    return resolveViaServers(ns, hostname);
  };
  if (hostname.endsWith("trycloudflare.com") || hostname.endsWith("trycloudflare.com.")) {
    return fromCloudflareNs();
  }
  try {
    return await resolveViaServers(RECURSIVE_DNS, hostname);
  } catch (error) {
    try {
      return await resolve4(hostname.endsWith(".") ? hostname : `${hostname}.`);
    } catch {
      try {
        return await fromCloudflareNs();
      } catch {
        throw error;
      }
    }
  }
};

let recursiveDnsInstalled = false;

export const useRecursiveDns = (): void => {
  if (recursiveDnsInstalled) {
    return;
  }
  recursiveDnsInstalled = true;
  const originalLookup = dns.lookup.bind(dns);
  const patched = (
    hostname: string,
    options?: unknown,
    callback?: unknown,
  ): void => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (typeof callback !== "function") {
      (originalLookup as (...args: unknown[]) => void)(hostname, options, callback);
      return;
    }
    const all = typeof options === "object" && options !== null && "all" in options && options.all === true;
    const cb = callback as (...args: unknown[]) => void;
    void resolveHostname(hostname).then(
      (addresses) => {
        if (all) {
          cb(
            null,
            addresses.map((address) => ({ address, family: 4 })),
          );
          return;
        }
        cb(null, addresses[0] ?? "127.0.0.1", 4);
      },
      () => {
        (originalLookup as (...args: unknown[]) => void)(hostname, options, cb);
      },
    );
  };
  dns.lookup = patched as unknown as typeof dns.lookup;
  dns.promises.lookup = (async (hostname: string, options?: dns.LookupOptions) => {
    const addresses = await resolveHostname(hostname);
    if (options?.all) {
      return addresses.map((address) => ({ address, family: 4 }));
    }
    return { address: addresses[0] ?? "127.0.0.1", family: 4 };
  }) as typeof dns.promises.lookup;
};

const errorCode = (error: unknown): string | undefined => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
};

const isEnotfound = (error: unknown): boolean => {
  if (errorCode(error) === "ENOTFOUND") {
    return true;
  }
  if (error instanceof Error) {
    return isEnotfound(error.cause);
  }
  return false;
};

const requestToIp = async (
  url: string,
  init: DiscoveryRequestInit,
): Promise<DiscoveryHttpResponse> => {
  const parsed = new URL(url);
  const ips = await resolveHostname(parsed.hostname);
  const first = ips[0];
  if (!first) {
    throw new Error(`no A records for ${parsed.hostname}`);
  }
  const body = init.body;
  const headers: Record<string, string> = {
    Host: parsed.hostname,
    ...(init.headers ?? {}),
  };
  if (body !== undefined && headers["content-length"] === undefined) {
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  const options: HttpsRequestOptions = {
    protocol: parsed.protocol,
    hostname: first,
    servername: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
    path: `${parsed.pathname}${parsed.search}`,
    method: init.method ?? "GET",
    headers,
  };
  const requestFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = requestFn(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 500;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => (text.length === 0 ? {} : (JSON.parse(text) as unknown)),
        });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
};

export const discoveryRequest = async (
  url: string,
  init: DiscoveryRequestInit = {},
): Promise<DiscoveryHttpResponse> => {
  try {
    const fetchInit: RequestInit = {
      method: init.method ?? "GET",
    };
    if (init.headers) {
      fetchInit.headers = init.headers;
    }
    if (init.body !== undefined) {
      fetchInit.body = init.body;
    }
    const response = await fetch(url, fetchInit);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      json: async () => (text.length === 0 ? {} : (JSON.parse(text) as unknown)),
    };
  } catch (error) {
    if (!isEnotfound(error)) {
      throw error;
    }
    return requestToIp(url, init);
  }
};
