// Cloud provider APIs added in October 2026: AWS (SigV4), Tencent Cloud (TC3), Alibaba Cloud (ACS3), Azure
// resource endpoints and regions as caller-chosen host parts, Google resource names, and the directory size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, resolveBase, UpstreamAuthRequired } from "../src/core/connector.js";
import { signAws, awsRegionFromHost, parseAwsCredentials } from "../src/core/aws-sigv4.js";
import { signTc3, signAcs3, signEdgegrid } from "../src/core/cloud-signers.js";
import { Catalog } from "../src/core/catalog.js";
import { loadDirectoryIndex } from "../src/core/directory.js";

const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
function recorder(reply = () => Response.json({ ok: true })) {
  const calls = [];
  return { calls, fetch: async (url, init) => (calls.push({ url: String(url), init }), reply(String(url), init)) };
}
const AWS_KEY = "AKIDEXAMPLE1234567:wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

test("SigV4 matches the AWS test suite (get-vanilla, get-vanilla-query-order-key)", () => {
  const credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
  const now = new Date("2015-08-30T12:36:00Z");
  const a = signAws({ method: "GET", url: "https://example.amazonaws.com/", headers: {}, service: "service", region: "us-east-1", credentials, now });
  assert.match(a.authorization, /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/);
  const b = signAws({ method: "GET", url: "https://example.amazonaws.com/?Param2=value2&Param1=value1", headers: {}, service: "service", region: "us-east-1", credentials, now });
  assert.match(b.authorization, /Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/);
  assert.equal(awsRegionFromHost("dynamodb.eu-west-1.amazonaws.com"), "eu-west-1");
  assert.equal(awsRegionFromHost("iam.amazonaws.com"), "us-east-1");
  assert.equal(parseAwsCredentials("short:x"), null);
});

test("TC3 and ACS3 signatures match Tencent's and Alibaba's own SDKs", () => {
  // Reference values computed with tencentcloud-sdk-python-common and alibabacloud-openapi-util.
  const t = signTc3({ url: "https://cvm.tencentcloudapi.com/", headers: { "x-tc-action": "DescribeInstances" }, body: '{"Limit": 1}', service: "cvm", credentials: { id: "test-secret-id", secret: "Gu5t9xGARNpq86cd98joQYCN3EXAMPLE" }, now: new Date(1551113065000) });
  assert.match(t.authorization, /Credential=test-secret-id\/2019-02-25\/cvm\/tc3_request, SignedHeaders=content-type;host, Signature=25f39ea186a5fa1b33faea08ae92a2db0905f5f5c92ba655593544d863f0ca1b$/);
  const a = signAcs3({ method: "POST", url: "https://ecs.cn-hangzhou.aliyuncs.com/?RegionId=cn-hangzhou&InstanceIds=%5B%22i-1%22%5D", headers: { "x-acs-action": "DescribeInstances", "x-acs-version": "2014-05-26" }, credentials: { id: "test-access-key-id", secret: "EXAMPLESECRETvalue123" }, now: new Date("2024-01-02T03:04:05Z"), nonce: "n-1" });
  assert.match(a.authorization, /Signature=392e32df679a53fa7354cc50bcded5ec7aa2cddb38c1cf82ab5fbbc6a1270d80$/);
  // Reference value computed with Akamai's edgegrid-python.
  const e = signEdgegrid({ method: "POST", url: "https://akab-host.luna.akamaiapis.net/papi/v1/properties?contractId=ctr_1", headers: {}, body: '{"a":1}', credentials: { clientToken: "akab-client-token-xxx", clientSecret: "SOMESECRETbase64value+/=", accessToken: "akab-access-token-xxx" }, now: new Date("2024-01-02T03:04:05Z"), nonce: "nonce-1" });
  assert.equal(e.authorization, "EG1-HMAC-SHA256 client_token=akab-client-token-xxx;access_token=akab-access-token-xxx;timestamp=20240102T03:04:05+0000;nonce=nonce-1;signature=dJT9omvg8Ob1czxDT/3U7DR4/jA/+i5HtaWTKJP0Y08=");
});

test("Akamai: the caller's API host must be on akamaiapis.net, EdgeGrid-signed", async () => {
  const { calls, fetch } = recorder();
  const api = { key: "cloud:akamai-papi", name: "Akamai PAPI", base: "{hostname}/papi/v1", hv: [{ n: "hostname", full: 1 }], hs: ["akamaiapis.net"], auth: { t: "edgegrid" } };
  const h = makeHandler(api, { method: "GET", path: "/groups", fields: [{ name: "hostname", src: "host" }], body: 0 });
  const key = { key: "akab-client-token-xxx:SOMESECRETbase64value:akab-access-token-xxx" };
  await h({ hostname: "akab-abc.luna.akamaiapis.net" }, { fetch, lookup, upstreamAuth: key });
  assert.equal(calls[0].url, "https://akab-abc.luna.akamaiapis.net/papi/v1/groups");
  assert.match(calls[0].init.headers.authorization, /^EG1-HMAC-SHA256 client_token=akab-client-token-xxx;access_token=akab-access-token-xxx;timestamp=\d{8}T\d\d:\d\d:\d\d\+0000;nonce=[0-9a-f-]{36};signature=/);
  await assert.rejects(h({ hostname: "https://attacker.example.net" }, { fetch, lookup, upstreamAuth: key }), /provider's domains/);
  await assert.rejects(h({ hostname: "akab-abc.luna.akamaiapis.net" }, { fetch, lookup, upstreamAuth: { key: "only-one-part" } }), UpstreamAuthRequired);
});

test("AWS JSON-protocol call: region host part, X-Amz-Target, empty JSON body, signed", async () => {
  const { calls, fetch } = recorder();
  const api = { key: "cloud:amazonaws-dynamodb", name: "DynamoDB", base: "https://dynamodb.{region}.amazonaws.com", hv: [{ n: "region", d: "us-east-1", e: ["us-east-1", "eu-west-1"] }], ct: "application/x-amz-json-1.0", auth: { t: "aws", svc: "dynamodb" } };
  const h = makeHandler(api, { method: "POST", path: "/", fields: [{ name: "region", src: "host" }], body: 2, fixed: { h: { "x-amz-target": "DynamoDB_20120810.ListTables" } } });
  await assert.rejects(h({}, { fetch, lookup }), UpstreamAuthRequired);
  await h({ region: "eu-west-1" }, { fetch, lookup, upstreamAuth: { key: AWS_KEY } });
  const c = calls[0];
  assert.equal(c.url, "https://dynamodb.eu-west-1.amazonaws.com/");
  assert.equal(c.init.headers["x-amz-target"], "DynamoDB_20120810.ListTables");
  assert.equal(c.init.headers["content-type"], "application/x-amz-json-1.0");
  assert.equal(c.init.body, "{}");
  assert.match(c.init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE1234567\/\d{8}\/eu-west-1\/dynamodb\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
  await assert.rejects(h({ region: "mars-1" }, { fetch, lookup, upstreamAuth: { key: AWS_KEY } }), /region must be one of/);
});

test("AWS Query protocol: Action and Version are fixed query parameters", async () => {
  const { calls, fetch } = recorder(() => new Response("<ok/>", { headers: { "content-type": "text/xml" } }));
  const h = makeHandler({ key: "cloud:amazonaws-iam", name: "IAM", base: "https://iam.amazonaws.com", auth: { t: "aws", svc: "iam", g: 1 } }, { method: "GET", path: "/", fields: [{ name: "UserName", src: "query" }], body: 0, fixed: { q: { Action: "GetUser", Version: "2010-05-08" } } });
  await h({ UserName: "bob" }, { fetch, lookup, upstreamAuth: { key: AWS_KEY } });
  assert.equal(calls[0].url, "https://iam.amazonaws.com/?Action=GetUser&Version=2010-05-08&UserName=bob");
  assert.match(calls[0].init.headers.authorization, /\/us-east-1\/iam\/aws4_request/);
});

test("Tencent Cloud: action headers, JSON body from fields, TC3 signature", async () => {
  const { calls, fetch } = recorder();
  const h = makeHandler({ key: "cloud:tencent-cvm", name: "Tencent CVM", base: "https://cvm.tencentcloudapi.com", auth: { t: "tc3", svc: "cvm" } }, { method: "POST", path: "/", fields: [{ name: "X-TC-Region", src: "header" }, { name: "Limit", src: "json", type: "integer" }, { name: "InstanceIds", src: "json", type: "array" }], body: 0, fixed: { h: { "x-tc-action": "DescribeInstances", "x-tc-version": "2017-03-12" } } });
  await h({ "X-TC-Region": "ap-singapore", Limit: 1, InstanceIds: '["ins-1"]' }, { fetch, lookup, upstreamAuth: { key: "test-secret-id-2:secretsecretsecret" } });
  const c = calls[0];
  assert.equal(c.init.body, '{"Limit":1,"InstanceIds":["ins-1"]}');
  assert.equal(c.init.headers["x-tc-region"], "ap-singapore");
  assert.equal(c.init.headers["x-tc-action"], "DescribeInstances");
  assert.equal(c.init.headers["content-type"], "application/json");
  assert.match(c.init.headers.authorization, /^TC3-HMAC-SHA256 Credential=test-secret-id-2\/\d{4}-\d{2}-\d{2}\/cvm\/tc3_request/);
});

test("Alibaba Cloud: regional endpoint from the provider's list only, ACS3 signature", async () => {
  const { calls, fetch } = recorder();
  const api = { key: "cloud:aliyun-ecs", name: "Alibaba ECS", base: "{endpoint}", hv: [{ n: "endpoint", d: "https://ecs.ap-southeast-1.aliyuncs.com", e: ["https://ecs.ap-southeast-1.aliyuncs.com", "https://ecs.cn-hangzhou.aliyuncs.com"], full: 1 }], hs: ["aliyuncs.com"], auth: { t: "acs3" } };
  const h = makeHandler(api, { method: "POST", path: "/", fields: [{ name: "endpoint", src: "host" }, { name: "RegionId", src: "query" }], body: 0, fixed: { h: { "x-acs-action": "DescribeRegions", "x-acs-version": "2014-05-26" } } });
  await h({ RegionId: "ap-southeast-1" }, { fetch, lookup, upstreamAuth: { key: "test-access-key-id:EXAMPLESECRETvalue123" } });
  assert.equal(calls[0].url, "https://ecs.ap-southeast-1.aliyuncs.com/?RegionId=ap-southeast-1");
  assert.match(calls[0].init.headers.authorization, /^ACS3-HMAC-SHA256 Credential=test-access-key-id,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=[0-9a-f]{64}$/);
  await assert.rejects(h({ endpoint: "https://evil.example.com" }, { fetch, lookup, upstreamAuth: { key: "test-access-key-id:EXAMPLESECRETvalue123" } }), /must be one of/);
});

test("host parts: subdomain labels stay under the provider's domain; whole endpoints must be https on listed domains", () => {
  const tenant = { base: "https://{domain}.atlassian.net/rest", hv: [{ n: "domain" }] };
  assert.equal(resolveBase(tenant, { domain: "acme" }), "https://acme.atlassian.net/rest");
  assert.equal(resolveBase(tenant, { domain: "eu.acme" }), "https://eu.acme.atlassian.net/rest");
  for (const bad of ["evil.com/x", "a@b", "x:80", "", "../x", "a b"]) assert.throws(() => resolveBase(tenant, { domain: bad }), /domain/, bad);
  const azure = { base: "{endpoint}/language", hv: [{ n: "endpoint", full: 1 }], hs: ["azure.com", "microsoft.com"] };
  assert.equal(resolveBase(azure, { endpoint: "https://my-lang.cognitiveservices.azure.com/" }), "https://my-lang.cognitiveservices.azure.com/language");
  assert.equal(resolveBase(azure, { endpoint: "my-lang.cognitiveservices.azure.com" }), "https://my-lang.cognitiveservices.azure.com/language");
  for (const bad of ["http://x.azure.com", "https://azure.com.evil.net", "https://user:pw@x.azure.com", "https://x.azure.com/?a=1"]) assert.throws(() => resolveBase(azure, { endpoint: bad }), /endpoint/, bad);
  const selfHosted = { base: "{server}/api", hv: [{ n: "server", full: 1 }] };
  assert.equal(resolveBase(selfHosted, { server: "https://forum.example.org" }), "https://forum.example.org/api");
});

test("Google resource names keep their slashes, never dot segments", async () => {
  const { calls, fetch } = recorder();
  const h = makeHandler({ key: "dev-tools:google-x", name: "G", base: "https://x.googleapis.com", auth: { t: "key", in: "query", name: "key" } }, { method: "GET", path: "/v1/{+name}", fields: [{ name: "name", src: "path" }], body: 0 });
  await h({ name: "projects/p 1/locations/us" }, { fetch, lookup, upstreamAuth: { key: "k" } });
  assert.equal(calls[0].url, "https://x.googleapis.com/v1/projects/p%201/locations/us?key=k");
  await assert.rejects(h({ name: "projects/../admin" }, { fetch, lookup, upstreamAuth: { key: "k" } }), /segments/);
});

test("directory: cloud catalogs are bring-your-own-key, every entry has its operations file", () => {
  const idx = loadDirectoryIndex();
  assert.ok(idx.length >= 3000, `directory has ${idx.length}`);
  const by = (p) => idx.filter((e) => e.p === p);
  assert.ok(by("amazonaws.com").length >= 350 && by("amazonaws.com").every((e) => e.a === "aws"));
  assert.ok(by("tencentcloudapi.com").length >= 200 && by("tencentcloudapi.com").every((e) => e.a === "tc3"));
  assert.ok(by("aliyuncs.com").length >= 300 && by("aliyuncs.com").every((e) => e.a === "acs3"));
  assert.ok(by("azure.com").length >= 300 && by("azure.com").every((e) => e.a), "Azure always needs a token");
  assert.ok(by("akamaiapis.net").length >= 40 && by("akamaiapis.net").every((e) => e.a === "edgegrid"));
  assert.equal(new Set(idx.map((e) => e.k)).size, idx.length, "unique keys");
  const c = new Catalog({ live: [], seed: false });
  const s = c.find("cloud:azure-arm-compute");
  assert.ok(s, "Azure compute management is listed");
  const ep = s.endpoints.find((e) => e.fields.some((f) => f.name === "api-version"));
  assert.ok(ep.fields.find((f) => f.name === "api-version").default, "api-version has a default");
  const lang = c.scrapers.find((x) => x.key.startsWith("cloud:azure-cognitiveservices-language"));
  if (lang) assert.ok(lang.endpoints[0].fields.some((f) => f.src === "host" && f.required), "Azure resource endpoint is a required field");
});
