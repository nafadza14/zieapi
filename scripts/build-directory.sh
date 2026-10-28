#!/usr/bin/env bash
# Rebuild src/catalog/openapi from the official sources (see docs/API-SOURCES.md).
# Needs git, python3 (+ pyyaml), node >= 20. Everything is cloned into $WORK (default /tmp/apizie-specs).
# Provider specs from earlier iterations live in $WORK/provider (one OpenAPI 3 JSON per API).
set -euo pipefail
WORK=${WORK:-/tmp/apizie-specs}
HERE=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$WORK/gh" "$WORK/norm"
cd "$WORK/gh"

clone() { [ -d "$2" ] || git clone -q --depth 1 ${3:-} "https://github.com/$1" "$2"; }
sparse() { [ -d "$2" ] || { git clone -q --depth 1 --filter=blob:none --sparse "https://github.com/$1" "$2" && git -C "$2" sparse-checkout set --no-cone $3; }; }

[ -d oad ] || { npm pack -q openapi-directory@1.3.17 && mkdir oad && tar xzf openapi-directory-1.3.17.tgz -C oad; }
sparse aws/aws-sdk-js awsjs 'apis/*.min.json'
sparse googleapis/google-api-go-client gapi '*-api.json'
sparse Azure/azure-rest-api-specs azure '/specification/*/data-plane/**/stable/**/*.json /specification/*/resource-manager/**/stable/**/*.json /specification/common-types/**'
clone konfig-sdks/openapi-examples konfig
clone HubSpot/HubSpot-public-api-spec-collection hubspot
clone microsoft/fabric-rest-api-specs fabric
clone twilio/sendgrid-oai sendgrid
clone meraki/openapi meraki
clone linode/linode-api-docs linode
clone TencentCloud/tencentcloud-cli tccli
clone aliyun/aliyun-openapi-meta alimeta
clone confluentinc/ccloud-sdk-go-v2 confluent
clone line/line-openapi line
clone webex/webex-openapi-specs webex
clone PaystackHQ/openapi paystack
clone lithic-com/lithic-openapi lithic
clone modern-treasury/modern-treasury-openapi mt
clone opsgenie/opsgenie-oas opsgenie
clone ringcentral/ringcentral-api-docs ringcentral
clone unit-finance/openapi-unit-sdk unit
clone zendesk/api-spec zendesk
clone bunq/doc bunq
clone elastic/cloud-sdk-go elastic
clone marqeta/marqeta-openapi marqeta
clone klaviyo/openapi klaviyo
clone mongodb/openapi mongodb
clone ory/sdk ory
clone akamai/akamai-apis akamai

P="python3 $HERE/scripts/prepare-extra-specs.py"
N="$WORK/norm"
rm -rf "$N" && mkdir -p "$N"
GUARD=$(python3 - <<'PY'
import json, glob, re
names = set()
for f in glob.glob("oad/package/api/amazonaws.com/*.json"):
    u = json.load(open(f))["info"]["x-origin"][0]["url"]
    names.add(re.search(r"apis/([^/]+?)\.normal\.json", u).group(1).rsplit("-", 3)[0])
print(",".join(sorted(names)))
PY
)
$P azure-dp azure/specification "$N/azure-dp"
$P arm-gh azure/specification "$N/arm"
$P aws-sdk awsjs/apis "$N/aws" --skip-names "$GUARD"
$P google gapi "$N/google" --skip-names fusiontables,urlshortener,qpxExpress,plusDomains,plus,partners,consumersurveys,surveys,playmoviespartner,replicapoolupdater,spectrum,appstate,tracing,prod_tt_sasportal,adexchangeseller,ftp,replicapool,cloudprint
$P hubspot hubspot "$N/hubspot"
$P files fabric "$N/fabric" --glob '*/swagger.json' --provider fabric.microsoft.com --prefix microsoft-fabric --auth bearer --category analytics --home https://learn.microsoft.com/rest/api/fabric/ --title-prefix "Microsoft Fabric"
$P files sendgrid "$N/sendgrid" --glob 'spec/json/tsg_*.json' --provider sendgrid.com --prefix sendgrid --category email --home https://www.twilio.com/docs/sendgrid/api-reference --title-prefix SendGrid
$P files meraki "$N/meraki" --glob 'openapi/spec3.json' --provider meraki.com --prefix cisco-meraki --category iot --home https://developer.cisco.com/meraki/api-v1/
$P files linode "$N/linode" --glob 'openapi.json' --provider linode.com --prefix linode --category cloud
$P tencent tccli/tccli/services "$N/tencent"
$P aliyun alimeta "$N/aliyun"
$P files confluent "$N/confluent" --glob '*/v*/api/openapi.yaml' --provider confluent.cloud --prefix confluent --category cloud --title-prefix "Confluent Cloud" --home https://docs.confluent.io/cloud/current/api.html
$P files line "$N/line" --glob '*.yml' --provider line.me --prefix line --category messaging --title-prefix LINE --home https://developers.line.biz/en/docs/
$P files webex "$N/webex" --glob 'public-spec/*.json' --provider webexapis.com --prefix webex --auth bearer --server https://webexapis.com/v1 --exclude 'contact-center' --category messaging --title-prefix Webex --home https://developer.webex.com/docs/api/getting-started
$P files paystack "$N/one" --glob 'dist/paystack.yaml' --provider paystack.co --prefix paystack --name paystack --category payment --home https://paystack.com/docs/api/
$P files lithic "$N/one" --glob 'lithic-openapi.yml' --provider lithic.com --prefix lithic --name lithic --category payment --server https://api.lithic.com
$P files mt "$N/one" --glob 'openapi/mt_openapi_spec_v1.yaml' --provider moderntreasury.com --prefix modern-treasury --name modern-treasury --category financial
$P files opsgenie "$N/one" --glob 'swagger.json' --provider opsgenie.com --prefix opsgenie --category monitoring
$P files ringcentral "$N/one" --glob 'specs/ringcentral_openapi3.json' --provider ringcentral.com --prefix ringcentral --name ringcentral --category telecom
$P files unit "$N/one" --glob 'openapi.json' --provider unit.co --prefix unit --category financial
$P files zendesk "$N/one" --glob 'openapi.yaml' --provider zendesk.com --prefix zendesk --category support
$P files bunq "$N/one" --glob 'swagger.json' --provider bunq.com --prefix bunq --name bunq --category financial --server https://api.bunq.com/v1
$P files elastic "$N/one" --glob 'api/apidocs.json' --provider elastic.co --prefix elastic-cloud --name elastic-cloud --category cloud --title-prefix "Elastic Cloud"
$P files marqeta "$N/one" --glob 'yaml/CoreAPI-3.0.40.yaml' --provider marqeta.com --prefix marqeta --name marqeta --category payment
$P files klaviyo "$N/one" --glob 'openapi/stable.json' --provider klaviyo.com --prefix klaviyo --name klaviyo --category marketing
$P files mongodb "$N/one" --glob 'openapi/v2.json' --provider mongodb.com --prefix mongodb-atlas --name mongodb-atlas --category cloud --title-prefix "MongoDB Atlas"
$P files ory "$N/one" --glob 'spec/client/v1.22.87.json' --provider ory.sh --prefix ory-network --name ory-network --category security --title-prefix "Ory Network"
$P akamai akamai "$N/akamai"
$P konfig konfig "$N/konfig" --skip-names height,spotify,nasa-tech-port  # height: unofficial spec; the others are listed from provider specs already

cd "$HERE"
APIZIE_AWS_META="$WORK/gh/awsjs/apis" node scripts/import-openapi.js "$WORK/gh/oad/package/api" "$WORK/provider" \
  "$N/azure-dp" "$N/arm" "$N/aws" "$N/google" "$N/hubspot" "$N/fabric" "$N/sendgrid" "$N/meraki" "$N/linode" \
  "$N/tencent" "$N/aliyun" "$N/akamai" "$N/confluent" "$N/line" "$N/webex" "$N/one" "$N/konfig"
