#!/usr/bin/env python3
"""Turn provider-published API descriptions into OpenAPI 3 JSON that scripts/import-openapi.js reads.

Sources (all published by the providers themselves, cloned from GitHub):
  azure-dp   Azure/azure-rest-api-specs  specification/*/data-plane/**/stable/<latest>/*.json  (Swagger 2.0)
  arm        Azure Resource Manager specs from the APIs.guru directory, merged into one API per Azure service
  google     googleapis/google-api-go-client  */*-api.json  (Google Discovery documents)
  konfig     konfig-sdks/openapi-examples  <company>/<api>/openapi.yaml  (provider specs collected by Konfig, MIT)

usage: python3 scripts/prepare-extra-specs.py <kind> <source-dir> <out-dir> [--skip-names a,b,c]
"""
import json, os, re, sys, glob, collections

kind, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
skip_names = set()
if "--skip-names" in sys.argv:
    skip_names = set(sys.argv[sys.argv.index("--skip-names") + 1].split(","))
os.makedirs(out, exist_ok=True)

def slug(s):
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", str(s))
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70] or "x"

def write(name, spec):
    with open(os.path.join(out, slug(name) + ".json"), "w") as f:
        json.dump(spec, f)

_ext_cache = {}
def get_ref(doc, ref):
    if not ref.startswith("#/"):
        # "definitions.json#/parameters/X": another file next to this one
        file, _, frag = ref.partition("#")
        base = doc.get("__dir")
        if not base or not file:
            return None
        path = os.path.normpath(os.path.join(base, file))
        if path not in _ext_cache:
            try:
                if path.endswith((".yaml", ".yml")):
                    import yaml
                    other = yaml.safe_load(open(path)) or {}
                else:
                    other = json.load(open(path))
            except Exception:
                other = {}
            other["__dir"] = os.path.dirname(path)
            _ext_cache[path] = other
        return get_ref(_ext_cache[path], "#" + frag) if frag else _ext_cache[path]
    o = doc
    for k in ref[2:].split("/"):
        o = o.get(k.replace("~1", "/").replace("~0", "~")) if isinstance(o, dict) else None
    return o

# ---------------------------------------------------------------------------------------------- Swagger 2.0 -> OAS 3
AZURE_SUFFIXES = [
    "azure.com", "azure.net", "windows.net", "microsoft.com", "azure-api.net", "azurewebsites.net", "azure-devices.net",
    "azure-devices-provisioning.net", "azurecr.io", "azconfig.io", "azuresynapse.net", "azure-dev.com", "azurefd.net",
    "cognitive.microsoft.com", "azure.us", "microsoftonline.com", "powerbi.com", "dynamics.com", "visualstudio.com",
    "communication.azure.com", "azureiotcentral.com", "azuredigitaltwins.net", "azurecontainerapps.io", "fabric.microsoft.com",
]

def sw2_param(doc, p):
    if "$ref" in p:
        p = get_ref(doc, p["$ref"]) or {}
    return p

def sw2_to_oas3(doc, host_vars=None):
    """Convert the parts the importer uses: servers, security, parameters, request bodies."""
    o = {"openapi": "3.0.0", "info": dict(doc.get("info", {})), "paths": {}, "components": {"securitySchemes": {}}}
    sec = {}
    for n, s in (doc.get("securityDefinitions") or {}).items():
        if s.get("type") == "apiKey":
            sec[n] = {"type": "apiKey", "in": s.get("in"), "name": s.get("name")}
        elif s.get("type") == "basic":
            sec[n] = {"type": "http", "scheme": "basic"}
        elif s.get("type") == "oauth2":
            sec[n] = {"type": "oauth2"}
    o["components"]["securitySchemes"] = sec
    if doc.get("security"):
        o["security"] = doc["security"]
    host_param_names = set()
    ph = doc.get("x-ms-parameterized-host")
    if ph:
        tpl = ph["hostTemplate"]
        variables = {}
        for p in ph.get("parameters", []):
            p = sw2_param(doc, p)
            if not p.get("name"):
                continue
            host_param_names.add(p["name"])
            v = {"description": (p.get("description") or "")[:300]}
            if "default" in p:
                v["default"] = p["default"]
            if p.get("enum"):
                v["enum"] = p["enum"]
            full = tpl.startswith("{" + p["name"] + "}") and not ph.get("useSchemePrefix", True)
            if full:
                v["x-apizie-full-url"] = True
            variables[p["name"]] = v
        url = tpl if not ph.get("useSchemePrefix", True) else "https://" + tpl
        url += (doc.get("basePath") or "").rstrip("/")
        o["servers"] = [{"url": url, "variables": variables}]
    else:
        host = doc.get("host")
        if host:
            schemes = doc.get("schemes") or ["https"]
            scheme = "https" if "https" in schemes else schemes[0]
            o["servers"] = [{"url": f"{scheme}://{host}{(doc.get('basePath') or '').rstrip('/')}"}]
    for path, item in (doc.get("paths") or {}).items():
        ni = {}
        common = [sw2_param(doc, p) for p in item.get("parameters", [])]
        for m in ("get", "post", "put", "patch", "delete"):
            op = item.get(m)
            if not op:
                continue
            params, body = [], None
            for p in common + [sw2_param(doc, p) for p in op.get("parameters", [])]:
                if not p.get("name") or p.get("name") in host_param_names:
                    continue
                if p.get("in") == "body":
                    body = {"required": bool(p.get("required")), "content": {"application/json": {"schema": {}}}}
                elif p.get("in") == "formData":
                    body = {"required": bool(p.get("required")), "content": {"application/x-www-form-urlencoded": {"schema": {}}}}
                elif p.get("in") in ("query", "path", "header"):
                    schema = {k: p[k] for k in ("type", "enum", "default") if k in p}
                    if p["name"] == "api-version" and "default" not in schema and doc.get("info", {}).get("version"):
                        schema["default"] = doc["info"]["version"]  # Azure: each file is one api-version
                    np = {"name": p["name"], "in": p["in"], "required": bool(p.get("required")) or p["in"] == "path", "schema": schema}
                    if p.get("description"):
                        np["description"] = p["description"]
                    params.append(np)
            nop = {k: op[k] for k in ("operationId", "summary", "description", "deprecated") if k in op}
            nop["parameters"] = params
            if body:
                nop["requestBody"] = body
            ni[m] = nop
        if ni:
            o["paths"][path] = ni
    return o

# --------------------------------------------------------------------------------------------------------- kinds
if kind == "azure-dp":
    groups = collections.defaultdict(dict)
    for f in glob.glob(os.path.join(src, "*/data-plane/**/stable/*/*.json"), recursive=True):
        if "/examples/" in f:
            continue
        pre, rest = f.split("/stable/")
        groups[pre].setdefault(rest.split("/")[0], []).append(f)
    n = 0
    for pre, versions in sorted(groups.items()):
        ver = max(versions)
        merged = {}
        for f in sorted(versions[ver]):
            try:
                doc = json.load(open(f))
            except Exception:
                continue
            if "swagger" not in doc:
                continue
            spec = sw2_to_oas3(doc)
            if not spec.get("servers") or not spec["paths"]:
                continue
            key = spec["servers"][0]["url"]
            if key in merged:
                merged[key]["paths"].update(spec["paths"])
                merged[key]["components"]["securitySchemes"].update(spec["components"]["securitySchemes"])
            else:
                merged[key] = spec
        rel = pre.split("specification/")[-1].replace("/data-plane", "")
        for i, (url, spec) in enumerate(merged.items()):
            name = rel if i == 0 else f"{rel}-{i + 1}"
            info = spec["info"]
            info["x-providerName"] = "azure.com"
            info["x-apizie-source"] = "azure-" + slug(name)
            info["x-apisguru-categories"] = ["cloud"]
            info["version"] = ver
            info["x-apizie-host-suffixes"] = AZURE_SUFFIXES
            info.setdefault("contact", {})["url"] = "https://learn.microsoft.com/rest/api/azure/"
            write("azure-" + name, spec)
            n += 1
    print("azure data-plane specs:", n)

elif kind == "arm-gh":
    # Azure/azure-rest-api-specs specification/<svc>/resource-manager/**/stable/<latest>/*.json, merged per service.
    SKIP = {"contosowidgetmanager", "widget", "azsadmin", "common-types"}
    groups = collections.defaultdict(lambda: collections.defaultdict(dict))
    for f in glob.glob(os.path.join(src, "*/resource-manager/**/stable/*/*.json"), recursive=True):
        if "/examples/" in f:
            continue
        svc = os.path.relpath(f, src).split("/")[0]
        if svc in SKIP:
            continue
        pre, rest = f.split("/stable/")
        groups[svc][pre].setdefault(rest.split("/")[0], []).append(f)
    n = 0
    for svc, pres in sorted(groups.items()):
        spec = {"openapi": "3.0.0", "info": {}, "servers": [{"url": "https://management.azure.com"}], "paths": {},
                "components": {"securitySchemes": {"azure_auth": {"type": "oauth2"}}}, "security": [{"azure_auth": []}]}
        titles = collections.Counter()
        latest = ""
        for pre, versions in pres.items():
            ver = max(versions)
            latest = max(latest, ver)
            for f in sorted(versions[ver]):
                try:
                    doc = json.load(open(f))
                except Exception:
                    continue
                if "swagger" not in doc:
                    continue
                doc["__dir"] = os.path.dirname(f)
                o = sw2_to_oas3(doc)
                titles[doc.get("info", {}).get("title", svc)] += len(o["paths"])
                for path, item in o["paths"].items():
                    spec["paths"].setdefault(path, item)
        if not spec["paths"]:
            continue
        top = titles.most_common(1)[0][0]
        nice = re.sub(r"\s*(Management)?\s*(Client|API|APIs|REST APIs|Service)$", "", top).strip() or svc
        nice = re.sub(r"^(Microsoft\.|Azure\s+)", "", nice)
        nice = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", nice) if " " not in nice else nice  # "RecoveryServices" -> "Recovery Services"
        spec["info"] = {"title": f"Azure {nice} management", "version": latest,
                        "description": f"Azure Resource Manager API for {nice}: manage these Azure resources in your subscription with a Microsoft Entra access token.",
                        "x-providerName": "azure.com", "x-apizie-source": "azure-arm-" + slug(svc), "x-apisguru-categories": ["cloud"],
                        "contact": {"url": "https://learn.microsoft.com/rest/api/azure/"}}
        write("azure-arm-" + svc, spec)
        n += 1
    print("azure resource manager services (GitHub):", n)

elif kind == "aws-sdk":
    # aws/aws-sdk-js apis/<uid>.min.json for services the APIs.guru directory does not have yet (--skip-names).
    best = {}
    for f in glob.glob(os.path.join(src, "*.min.json")):
        uid = os.path.basename(f)[:-9]
        name = uid.rsplit("-", 3)[0]
        if name in skip_names:
            continue
        if name not in best or uid > best[name]:
            best[name] = uid
    TYPES = {"integer": "integer", "long": "integer", "float": "number", "double": "number", "boolean": "boolean", "list": "array", "structure": "object", "map": "object"}
    n = 0
    for name, uid in sorted(best.items()):
        d = json.load(open(os.path.join(src, uid + ".min.json")))
        m = d.get("metadata", {})
        proto = m.get("protocol")
        if proto not in ("json", "rest-json", "query", "rest-xml"):
            continue
        prefix = m.get("endpointPrefix", name)
        spec = {"openapi": "3.0.0", "info": {"title": m.get("serviceFullName", name), "version": m.get("apiVersion"), "description": "",
                "x-providerName": "amazonaws.com", "x-serviceName": name, "x-apisguru-categories": ["cloud"],
                "x-origin": [{"url": f"https://raw.githubusercontent.com/aws/aws-sdk-js/master/apis/{uid}.normal.json"}],
                "contact": {"url": f"https://docs.aws.amazon.com/"}},
                "servers": [{"url": f"https://{prefix}.{{region}}.amazonaws.com", "variables": {"region": {"default": "us-east-1", "description": "The AWS region",
                    "enum": ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1", "eu-south-1", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-southeast-1", "ap-southeast-2", "ap-south-1", "ap-east-1", "sa-east-1", "me-south-1", "af-south-1"]}}}],
                "paths": {}}
        shapes = d.get("shapes", {})
        for op_name, op in d.get("operations", {}).items():
            http = op.get("http", {})
            method = http.get("method", "POST").lower()
            members = (shapes.get((op.get("input") or {}).get("shape"), {}) or {}).get("members", {})
            required = set((shapes.get((op.get("input") or {}).get("shape"), {}) or {}).get("required", []))
            params, has_body = [], False
            for mn, mem in members.items():
                loc = mem.get("location")
                t = TYPES.get(shapes.get(mem.get("shape"), {}).get("type"), "string")
                if proto in ("json",):
                    has_body = True
                    continue
                if proto == "query":
                    if t in ("string", "integer", "number", "boolean"):
                        params.append({"name": mn, "in": "query", "required": mn in required, "schema": {"type": t}})
                    continue
                if loc == "uri":
                    params.append({"name": mem.get("locationName", mn), "in": "path", "required": True, "schema": {"type": "string"}})
                elif loc == "querystring":
                    params.append({"name": mem.get("locationName", mn), "in": "query", "required": mn in required, "schema": {"type": t}})
                elif loc == "header":
                    params.append({"name": mem.get("locationName", mn), "in": "header", "required": mn in required, "schema": {"type": "string"}})
                elif loc is None:
                    has_body = True
            nop = {"operationId": op_name, "summary": re.sub(r"([a-z])([A-Z])", r"\1 \2", op_name), "parameters": params}
            if proto == "json":
                path, method = f"/#X-Amz-Target={m.get('targetPrefix')}.{op_name}", "post"
            elif proto == "query":
                path, method = f"/#Action={op_name}", "get"
            else:
                path = http.get("requestUri", "/").split("?")[0]
                path = re.sub(r"\{([^}]+)\+\}", r"{+\1}", path)
                q = http.get("requestUri", "").partition("?")[2]
                if q:
                    path += "#" + q
            if has_body and method != "get":
                nop["requestBody"] = {"required": False, "content": {("text/xml" if proto == "rest-xml" else "application/json"): {"schema": {}}}}
            spec["paths"].setdefault(path, {})[method] = nop
        if spec["paths"]:
            write("aws-" + name, spec)
            n += 1
    print("aws services from aws-sdk-js:", n)

elif kind == "tencent":
    # TencentCloud/tencentcloud-cli tccli/services/<svc>/<version>/api.json (official Tencent Cloud API 3.0 metadata).
    names = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "tencent-names.json")))
    TYPES = {"int": "integer", "uint64": "integer", "int64": "integer", "integer": "integer", "float": "number", "double": "number", "bool": "boolean", "list": "array", "object": "object"}
    n = 0
    for svc in sorted(os.listdir(src)):
        vs = sorted(glob.glob(os.path.join(src, svc, "v*", "api.json")))
        if not vs or svc not in names:
            continue
        d = json.load(open(vs[-1]))
        ver = d.get("metadata", {}).get("apiVersion") or d.get("version")
        objects = d.get("objects", {})
        spec = {"openapi": "3.0.0", "info": {"title": f"Tencent Cloud {names[svc]}", "version": ver,
                "description": f"Tencent Cloud API 3.0 for {names[svc]} ({svc}). Every call is signed with TC3-HMAC-SHA256 using your SecretId and SecretKey.",
                "x-providerName": "tencentcloudapi.com", "x-apizie-source": "tencent-" + svc, "x-apisguru-categories": ["cloud"],
                "x-apizie-auth-detail": {"t": "tc3", "svc": svc}, "contact": {"url": "https://www.tencentcloud.com/document/api"}},
                "servers": [{"url": f"https://{svc}.tencentcloudapi.com"}], "paths": {}}
        for action, a in sorted(d.get("actions", {}).items()):
            if a.get("status", "online") != "online":
                continue
            params = [{"name": "X-TC-Region", "in": "header", "required": False, "schema": {"type": "string"},
                       "description": "Region for regional products, for example ap-singapore, ap-guangzhou, na-siliconvalley"}]
            for m in (objects.get(a.get("input"), {}) or {}).get("members", []):
                if m.get("disabled"):
                    continue
                params.append({"name": m["name"], "in": "x-json", "required": bool(m.get("required")), "schema": {"type": TYPES.get(m.get("type"), "string")}})
            spec["paths"]["/#" + action] = {"post": {"operationId": action, "summary": re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", action),
                "parameters": params, "x-apizie-fixed": {"h": {"x-tc-action": action, "x-tc-version": ver}}}}
        if spec["paths"]:
            write("tencent-" + svc, spec)
            n += 1
    print("tencent cloud products:", n)

elif kind == "aliyun":
    # aliyun/aliyun-openapi-meta: metadatas/products.json + canonical/<product>/<version>/<Api>.json (English docs).
    prods = json.load(open(os.path.join(src, "metadatas", "products.json")))["products"]
    TYPES = {"integer": "integer", "int": "integer", "long": "integer", "number": "number", "float": "number", "double": "number", "boolean": "boolean", "array": "array", "object": "object", "map": "object"}
    n = 0
    for p in prods:
        code = p["code"].lower()  # canonical/ uses lower-case product codes
        vdirs = sorted(glob.glob(os.path.join(src, "canonical", code, "*")))
        ver = p.get("plugin_default_version") if p.get("plugin_default_version") and os.path.isdir(os.path.join(src, "canonical", code, p.get("plugin_default_version", ""))) else (os.path.basename(vdirs[-1]) if vdirs else None)
        if not ver:
            continue
        en = (p.get("name") or {}).get("en") or code
        title = en if (en != code and not en.islower()) else en.upper() if len(en) <= 5 else en.replace("-", " ").title()
        eps = p.get("regional_endpoints") or {}
        servers = []
        if p.get("global_endpoint"):
            servers = [{"url": "https://" + p["global_endpoint"]}]
        elif eps:
            urls = sorted(set("https://" + h for h in eps.values()))
            pref = next((eps[r] for r in ("ap-southeast-1", "us-east-1", "eu-central-1", "cn-hangzhou") if r in eps), list(eps.values())[0])
            servers = [{"url": "{endpoint}", "variables": {"endpoint": {"default": "https://" + pref, "enum": urls,
                        "description": "Regional endpoint, for example https://" + pref, "x-apizie-full-url": True}}}]
        else:
            servers = [{"url": f"https://{code}.aliyuncs.com"}]
        spec = {"openapi": "3.0.0", "info": {"title": f"Alibaba Cloud {title}", "version": ver,
                "description": f"Alibaba Cloud OpenAPI for {title} ({code}, version {ver}). Calls are signed with ACS3-HMAC-SHA256 using your AccessKey ID and secret.",
                "x-providerName": "aliyuncs.com", "x-apizie-source": "aliyun-" + code, "x-apisguru-categories": ["cloud"],
                "x-apizie-auth-detail": {"t": "acs3"}, "x-apizie-host-suffixes": ["aliyuncs.com", "aliyun.com", "alibabacloud.com"],
                "contact": {"url": f"https://api.alibabacloud.com/product/{code}"}}, "servers": servers, "paths": {}}
        for f in sorted(glob.glob(os.path.join(src, "canonical", code, ver, "*.json"))):
            try:
                d = json.load(open(f))
            except Exception:
                continue
            if d.get("deprecated"):
                continue
            op = d.get("operation", {})
            action = op.get("action") or d.get("name") or os.path.basename(f)[:-5]
            params = []
            for prm in d.get("parameters", []):
                loc = prm.get("location", "query")
                name = prm.get("raw_name") or prm.get("name")
                t = TYPES.get(prm.get("type"), "string")
                if loc == "path":
                    params.append({"name": name, "in": "path", "required": True, "schema": {"type": "string"}, "description": prm.get("help_en", "")})
                elif loc == "header":
                    params.append({"name": name, "in": "header", "required": bool(prm.get("required")), "schema": {"type": "string"}, "description": prm.get("help_en", "")})
                elif loc == "body" and op.get("api_style") == "ROA":
                    params.append({"name": name, "in": "x-json", "required": bool(prm.get("required")), "schema": {"type": t}, "description": prm.get("help_en", "")})
                else:
                    sch = {"type": "string" if t in ("array", "object") else t}
                    if prm.get("enum") and isinstance(prm["enum"], list):
                        sch["enum"] = [str(x) for x in prm["enum"]][:40]
                    params.append({"name": name, "in": "query", "required": bool(prm.get("required")), "schema": sch,
                                   "description": (prm.get("help_en") or "") + (" (JSON-encoded)" if t in ("array", "object") else ""), **({"example": prm["example"]} if isinstance(prm.get("example"), (str, int, float)) else {})})
            method = (op.get("method") or "POST").split("|")[0].lower()
            if op.get("api_style") == "ROA" and op.get("url"):
                path = op["url"] if op["url"].startswith("/") else "/" + op["url"]
                path += "#" + action
            else:
                path, method = "/#" + action, "post"
            entry = {"operationId": action, "summary": d.get("description_en") or action, "parameters": params,
                     "x-apizie-fixed": {"h": {"x-acs-action": action, "x-acs-version": ver}}}
            spec["paths"].setdefault(path, {})[method] = entry
        if spec["paths"]:
            write("aliyun-" + code, spec)
            n += 1
    print("alibaba cloud products:", n)

elif kind == "akamai":
    # akamai/akamai-apis apis/<api>/<version>/openapi.json, newest version per API. Every Akamai API is served from
    # the account's own host (akab-....luna.akamaiapis.net) and signed with EdgeGrid.
    latest = {}
    for f in glob.glob(os.path.join(src, "apis", "*", "v*", "openapi.json")):
        api, ver = f.split("/")[-3:-1]
        if api not in latest or int(ver[1:] or 0) > int(latest[api][0][1:] or 0):
            latest[api] = (ver, f)
    n = 0
    for api, (ver, f) in sorted(latest.items()):
        d = json.load(open(f))
        d["__dir"] = os.path.dirname(f)
        for path, item in (d.get("paths") or {}).items():
            if "$ref" in item:
                item.update(get_ref(d, item.pop("$ref")) or {})
            for m, op in list(item.items()):
                if not isinstance(op, dict):
                    continue
                if isinstance(op.get("parameters"), list):
                    op["parameters"] = [get_ref(d, x["$ref"]) if isinstance(x, dict) and "$ref" in x and not x["$ref"].startswith("#") else x for x in op["parameters"]]
                    op["parameters"] = [x for x in op["parameters"] if isinstance(x, dict)]
            if isinstance(item.get("parameters"), list):
                item["parameters"] = [x for x in (get_ref(d, x["$ref"]) if isinstance(x, dict) and "$ref" in x and not x["$ref"].startswith("#") else x for x in item["parameters"]) if isinstance(x, dict)]
        d.pop("__dir", None)
        url = ((d.get("servers") or [{}])[0]).get("url", "")
        rest = re.sub(r"^https?://\{hostname\}", "", url)
        d["servers"] = [{"url": "{hostname}" + rest, "variables": {"hostname": {"x-apizie-full-url": True, "description": "Your API client's host from Akamai Control Center, for example https://akab-xxxx.luna.akamaiapis.net"}}}]
        info = d.setdefault("info", {})
        info["title"] = re.sub(r"^Akamai:\s*", "Akamai ", info.get("title", api))
        if not info["title"].startswith("Akamai"):
            info["title"] = "Akamai " + info["title"]
        info.update({"x-providerName": "akamaiapis.net", "x-apizie-source": "akamai-" + api, "x-apisguru-categories": ["cloud"],
                     "x-apizie-auth-detail": {"t": "edgegrid"}, "x-apizie-host-suffixes": ["akamaiapis.net"]})
        info.setdefault("contact", {})["url"] = "https://techdocs.akamai.com/home/page/apis"
        write("akamai-" + api, json.loads(json.dumps(d, default=str)))
        n += 1
    print("akamai apis:", n)

elif kind == "arm":
    groups = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(src, "azure.com/**/*.json"), recursive=True)):
        doc = json.load(open(f))
        url = ((doc.get("servers") or [{}])[0]).get("url", "")
        if "management.azure.com" not in url:
            continue
        svc = f.split("azure.com/")[1].split("/")[0].replace(".json", "").split("-")[0]
        groups[svc.lower()].append(doc)
    n = 0
    for svc, docs in sorted(groups.items()):
        base = docs[0]
        spec = {"openapi": "3.0.0", "info": dict(base["info"]), "servers": [{"url": "https://management.azure.com"}], "paths": {},
                "components": {"securitySchemes": {"azure_auth": {"type": "oauth2"}}}, "security": [{"azure_auth": []}]}
        titles = collections.Counter()
        for d in docs:
            titles[d["info"].get("title", svc)] += len(d.get("paths", {}))
            ver = d["info"].get("version")
            for path, item in d.get("paths", {}).items():
                ni = {}
                for m, op in item.items():
                    if m not in ("get", "post", "put", "patch", "delete") or not isinstance(op, dict):
                        continue
                    op = dict(op)
                    ps = []
                    for p in list(item.get("parameters", [])) + list(op.get("parameters", [])):
                        if "$ref" in p:
                            p = get_ref(d, p["$ref"]) or {}
                        if not p.get("name"):
                            continue
                        p = dict(p)
                        if "$ref" in (p.get("schema") or {}):
                            p["schema"] = get_ref(d, p["schema"]["$ref"]) or {}
                        if p["name"] == "api-version":
                            p["schema"] = dict(p.get("schema") or {}, default=ver)
                        ps.append(p)
                    op["parameters"] = ps
                    rb = op.get("requestBody")
                    if rb and "$ref" in rb:
                        op["requestBody"] = get_ref(d, rb["$ref"]) or {}
                    ni[m] = op
                if ni and path not in spec["paths"]:
                    spec["paths"][path] = ni
        top = titles.most_common(1)[0][0]
        nice = re.sub(r"\s*(Management)?\s*(Client|API|APIs|REST APIs)$", "", top).strip() or svc
        spec["info"]["title"] = f"Azure {nice} management" if not nice.lower().startswith("azure") else f"{nice} management"
        spec["info"]["description"] = f"Azure Resource Manager API for {nice}: manage these Azure resources in your subscription with an Azure AD access token."
        spec["info"]["x-providerName"] = "azure.com"
        spec["info"]["x-apizie-source"] = "azure-arm-" + svc
        spec["info"]["x-apisguru-categories"] = ["cloud"]
        spec["info"].setdefault("contact", {})["url"] = "https://learn.microsoft.com/rest/api/azure/"
        write("azure-arm-" + svc, spec)
        n += 1
    print("azure resource manager services:", n)

elif kind == "google":
    best = {}
    for f in glob.glob(os.path.join(src, "**/*-api.json"), recursive=True):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        name = d.get("name")
        if not name or name in skip_names:
            continue
        rank = (0 if re.search(r"(alpha|beta|sandbox)", d.get("version", "")) else 1, d.get("version", ""))
        if name not in best or rank > best[name][0]:
            best[name] = (rank, d)
    n = 0
    for name, (_, d) in sorted(best.items()):
        base = (d.get("rootUrl") or "").rstrip("/") + "/" + (d.get("servicePath") or "").strip("/")
        spec = {"openapi": "3.0.0", "info": {"title": d.get("title") or name, "description": d.get("description", ""), "version": d.get("version"),
                "x-providerName": "googleapis.com", "x-apizie-source": "google-" + name, "x-apizie-replaces": "googleapis.com/" + name, "x-serviceName": name,
                "x-apisguru-categories": ["developer_tools"], "contact": {"url": d.get("documentationLink") or "https://developers.google.com"}},
                "servers": [{"url": base.rstrip("/")}], "paths": {},
                "components": {"securitySchemes": {"api_key": {"type": "apiKey", "in": "query", "name": "key"}, "oauth": {"type": "oauth2"}}},
                "security": [{"api_key": []}, {"oauth": []}]}
        common = d.get("parameters", {})
        def walk(res):
            for m in (res.get("methods") or {}).values():
                # {+name} is RFC 6570 reserved expansion: the value keeps its slashes (projects/p/locations/l).
                path = "/" + m.get("path", "").lstrip("/")
                params = []
                for pn, p in (m.get("parameters") or {}).items():
                    loc = p.get("location", "query")
                    schema = {"type": p.get("type", "string")}
                    if p.get("enum"):
                        schema["enum"] = p["enum"]
                    if "default" in p:
                        schema["default"] = p["default"]
                    params.append({"name": pn, "in": loc, "required": bool(p.get("required")) or loc == "path", "schema": schema, "description": p.get("description", "")})
                op = {"operationId": m.get("id"), "summary": m.get("description", ""), "parameters": params}
                if m.get("request"):
                    op["requestBody"] = {"required": True, "content": {"application/json": {"schema": {}}}}
                spec["paths"].setdefault(path, {})[m.get("httpMethod", "GET").lower()] = op
            for sub in (res.get("resources") or {}).values():
                walk(sub)
        walk(d)
        if spec["paths"]:
            write("google-" + name, spec)
            n += 1
    print("google discovery apis:", n)

elif kind == "files":
    # Generic: every spec file matching a glob under <source-dir>, from one provider.
    #   --glob 'spec/json/*.json' --provider sendgrid.com --prefix sendgrid --auth bearer --category messaging
    import yaml
    opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    pattern, provider, prefix = opt("--glob"), opt("--provider"), opt("--prefix")
    auth, cat, home = opt("--auth"), opt("--category"), opt("--home")
    n = 0
    for f in sorted(glob.glob(os.path.join(src, pattern), recursive=True)):
        if opt("--exclude") and re.search(opt("--exclude"), f):
            continue
        try:
            d = json.load(open(f)) if f.endswith(".json") else yaml.safe_load(open(f))
        except Exception:
            continue
        if not isinstance(d, dict) or not d.get("paths"):
            continue
        d["__dir"] = os.path.dirname(f)
        spec = sw2_to_oas3(d) if "swagger" in d else d
        spec.pop("__dir", None)
        rel = os.path.relpath(f, src)
        stem = os.path.dirname(rel) if os.path.basename(f) in ("swagger.json", "openapi.json", "openapi.yaml") else re.sub(r"\.(json|ya?ml)$", "", rel)
        parts = [x for x in re.split(r"[/_]", stem) if x.lower() not in ("api", "spec", "spec3", "json", "yaml", "openapi", "swagger", "tsg", "public-spec", "dist", "main", "")]
        name = opt("--name") or prefix + ("-" + slug("-".join(parts)) if parts else "")
        info = spec.setdefault("info", {})
        if opt("--server"):  # the provider's documented production server, when the spec lists only a sandbox
            spec["servers"] = [{"url": opt("--server")}]
        info["x-providerName"] = provider
        info["x-apizie-source"] = name
        if auth and not (spec.get("components") or {}).get("securitySchemes"):
            info["x-apizie-auth"] = auth
        tp = opt("--title-prefix")
        if tp and tp.lower() not in str(info.get("title", "")).lower():
            info["title"] = f"{tp} {info.get('title') or ''}".strip()
        if cat:
            info["x-apisguru-categories"] = [cat]
        if home:
            info.setdefault("contact", {})["url"] = home
        write(name, json.loads(json.dumps(spec, default=str)))
        n += 1
    print(prefix, "specs:", n)

elif kind == "hubspot":
    HUBSPOT_GURU = {("Events", "Send Event Completions"): "analytics", ("Auth", "Oauth"): "auth", ("Automation", "Actions V4"): "automation",
                    ("Business Units", "Business Units"): "business units", ("CMS", "Domains"): "cms", ("Communication Preferences", "Subscriptions"): "communication-preferences",
                    ("Conversations", "Visitor Identification"): "conversations", ("CRM", "Public App Crm Cards"): "crm", ("Events", "Events"): "events",
                    ("Files", "Files"): "files", ("Marketing", "Marketing Events"): "marketing", ("Webhooks", "Webhooks"): "webhooks"}
    # PublicApiSpecs/<Group>/<API>/Rollouts/<id>/<version>/<file>.json: newest dated non-beta version per API.
    n = 0
    for api_dir in sorted(glob.glob(os.path.join(src, "PublicApiSpecs/*/*"))):
        group, api = api_dir.split("/")[-2:]
        if group == "Test" or re.search(r"test", api, re.I):
            continue
        cands = []
        for f in glob.glob(os.path.join(api_dir, "Rollouts/*/*/*.json")):
            ver = f.split("/")[-2]
            if "beta" in ver or "Collection" in f:
                continue
            cands.append((re.sub(r"^v(\d+)$", r"0000-\1", ver), f))
        if not cands:
            continue
        f = max(cands)[1]
        d = json.load(open(f))
        if not d.get("paths"):
            continue
        info = d.setdefault("info", {})
        info["x-providerName"] = "hubapi.com"
        info["x-apizie-source"] = "hubspot-" + slug(group + "-" + api)
        if group.lower() not in str(info.get("title", "")).lower() and "hubspot" not in str(info.get("title", "")).lower():
            info["title"] = f"HubSpot {api}" if group.lower() in api.lower() or group == "CRM" else f"HubSpot {group} {api}"
        elif "hubspot" not in str(info.get("title", "")).lower():
            info["title"] = "HubSpot " + info.get("title", api)
        info["title"] = re.sub(r"\b(\w+) \1\b", r"\1", info["title"])  # "Files Files" -> "Files"
        info["x-apisguru-categories"] = ["marketing" if group in ("Marketing", "CMS", "Automation") else "customer_relation"]
        # The APIs.guru directory has a dozen older HubSpot specs; the newer spec of the same API takes their place.
        if (group, api) in HUBSPOT_GURU:
            info["x-apizie-replaces"] = "hubapi.com/" + HUBSPOT_GURU[(group, api)]
        info.setdefault("contact", {})["url"] = "https://developers.hubspot.com/docs/api/overview"
        write("hubspot-" + group + "-" + api, d)
        n += 1
    print("hubspot apis:", n)

elif kind == "konfig":
    import yaml
    nonprod = re.compile(r"(sandbox|ote-|demo|staging|\btest|\.test|dev\.|-dev\.|localhost|example\.com|mock|<)", re.I)
    n, skipped = 0, collections.Counter()
    for f in sorted(glob.glob(os.path.join(src, "**/openapi.yaml"), recursive=True)):
        rel = os.path.relpath(os.path.dirname(f), src)
        if rel.replace("/", "-") in skip_names or rel.split("/")[0] in skip_names:
            skipped["skipped by name"] += 1
            continue
        try:
            d = yaml.safe_load(open(f))
        except Exception:
            skipped["yaml"] += 1
            continue
        if not isinstance(d, dict) or "openapi" not in d:
            skipped["not oas3"] += 1
            continue
        srv = [s for s in (d.get("servers") or []) if isinstance(s, dict) and s.get("url")]
        good = [s for s in srv if not nonprod.search(s["url"])]
        if not good:
            skipped["no production server"] += 1
            continue
        d["servers"] = good
        about = {}
        ap = os.path.join(os.path.dirname(f), "about.json")
        if not os.path.exists(ap):
            ap = os.path.join(src, rel.split("/")[0], "about.json")
        if os.path.exists(ap):
            about = json.load(open(ap))
        info = d.setdefault("info", {})
        url = good[0]["url"]
        host = re.sub(r"^[a-z]+://", "", url).split("/")[0].split(":")[0]
        info["x-providerName"] = host
        info["x-apizie-source"] = "konfig-" + slug(rel)
        if about.get("homepage"):
            info.setdefault("contact", {})["url"] = about["homepage"]
        if about.get("company") and about["company"].lower() not in str(info.get("title", "")).lower():
            info["title"] = f"{about['company']} {info.get('title') or ''}".strip()
        if not info.get("description") and about.get("description"):
            info["description"] = about["description"]
        # Hand-pick a category from the description where the spec has none.
        info.setdefault("x-apisguru-categories", [])
        write(rel.replace("/", "-"), json.loads(json.dumps(d, default=str)))
        n += 1
    print("konfig specs:", n, dict(skipped))
