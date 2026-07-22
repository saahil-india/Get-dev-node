#!/usr/bin/env bash
exec > /tmp/smoketest.log 2>&1
cd /sessions/keen-funny-clarke/mnt/outputs/gd-portal/backend

export DATABASE_URL="postgres://postgres@127.0.0.1:5433/postgres"
export JWT_SECRET="test-secret"
export PORT=3000
# pglite-socket's multiplexer corrupts protocol state under real connection-pool concurrency
# (a known pglite-socket limitation, not an app bug) — pin to 1 connection for this harness only.
export PG_POOL_MAX=1

echo "[$(date +%T)] starting pg-dev-server"
node dev-tools/pg-dev-server.mjs > /tmp/pgdev.log 2>&1 &
PG_PID=$!
for i in $(seq 1 15); do timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/5433" >/dev/null 2>&1 && break; sleep 0.3; done
echo "[$(date +%T)] pg-dev-server ready (attempt $i)"

echo "[$(date +%T)] migrate"
node src/db/migrate.js > /tmp/migrate.log 2>&1
echo "[$(date +%T)] seed"
node src/db/seed.js > /tmp/seed.log 2>&1

echo "[$(date +%T)] starting api server"
node src/server.js > /tmp/api.log 2>&1 &
API_PID=$!
for i in $(seq 1 15); do curl -s --max-time 1 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 0.3; done
echo "[$(date +%T)] api server ready (attempt $i)"

echo "=== health ==="; curl -s --max-time 5 http://127.0.0.1:3000/api/health; echo

OWNER_TOKEN=$(curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@getdeveloper.in","password":"admin123"}' | jq -r .token)
RAVI_TOKEN=$(curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"ravi@getdeveloper.in","password":"ravi12345"}' | jq -r .token)
SONIA_TOKEN=$(curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"sonia@getdeveloper.in","password":"sonia12345"}' | jq -r .token)
echo "owner=${OWNER_TOKEN:0:12} ravi=${RAVI_TOKEN:0:12} sonia=${SONIA_TOKEN:0:12}"

echo "=== wrong password ==="; curl -s --max-time 5 -o /dev/null -w "status=%{http_code}\n" -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@getdeveloper.in","password":"WRONG"}'

echo "=== recruiter scope ==="; curl -s --max-time 5 "http://127.0.0.1:3000/api/vendors?perPage=100" -H "Authorization: Bearer $RAVI_TOKEN" | jq '{total, owners: [.items[].owner_name] | unique}'
echo "=== owner scope ==="; curl -s --max-time 5 "http://127.0.0.1:3000/api/vendors?perPage=100" -H "Authorization: Bearer $OWNER_TOKEN" | jq '.total'
echo "=== sales forbidden from vendors ==="; curl -s --max-time 5 -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:3000/api/vendors -H "Authorization: Bearer $SONIA_TOKEN"

echo "=== dup vendor rule ==="
curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/vendors -H "Authorization: Bearer $RAVI_TOKEN" -H 'Content-Type: application/json' -d '{"company_name":"Acme Technologies","poc_name":"John Doe","staffing_type":"both"}' | jq -c .
curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/vendors -H "Authorization: Bearer $RAVI_TOKEN" -H 'Content-Type: application/json' -d '{"company_name":"Acme Technologies","poc_name":"Someone Else","staffing_type":"contract"}' | jq -c '{id: .vendor.id, company_name: .vendor.company_name, poc_name: .vendor.poc_name}'

echo "=== resume upload + tag + dup detect ==="
echo "Senior DevOps engineer with 8 years experience. Skilled in Kubernetes, Docker, AWS, Terraform, CI/CD pipelines." > /tmp/test_resume.txt
curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/candidates/upload -H "Authorization: Bearer $RAVI_TOKEN" -F "resumes=@/tmp/test_resume.txt" | jq -c '.results[] | {filename, status, category: .candidate.category, seniority: .candidate.seniority}'
curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/candidates/upload -H "Authorization: Bearer $RAVI_TOKEN" -F "resumes=@/tmp/test_resume.txt" | jq -c .

echo "=== sales client create + kanban move ==="
CLIENT_JSON=$(curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/sales/clients -H "Authorization: Bearer $SONIA_TOKEN" -H 'Content-Type: application/json' -d '{"company":"Test Client Co","contact":"Jane Buyer","stage":"Lead","source":"Referral"}')
CLIENT_ID=$(echo "$CLIENT_JSON" | jq -r .client.id)
curl -s --max-time 5 -X PATCH http://127.0.0.1:3000/api/sales/clients/$CLIENT_ID -H "Authorization: Bearer $SONIA_TOKEN" -H 'Content-Type: application/json' -d '{"stage":"Won"}' | jq -c '{id: .client.id, stage: .client.stage}'

echo "=== sales dashboard ==="; curl -s --max-time 5 http://127.0.0.1:3000/api/sales/dashboard/me -H "Authorization: Bearer $SONIA_TOKEN" | jq -c .
echo "=== leaderboard ==="; curl -s --max-time 5 http://127.0.0.1:3000/api/sales/leaderboard -H "Authorization: Bearer $OWNER_TOKEN" | jq -c '.items[] | {name, leads, won, conv}'
echo "=== owner dashboard ==="; curl -s --max-time 5 http://127.0.0.1:3000/api/dashboard -H "Authorization: Bearer $OWNER_TOKEN" | jq -c '{totalResumes, vendorCount, recruiterPerformance}'

echo "=== subadmin creation + module enforcement ==="
curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/users -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Test Sub","email":"testsub@getdeveloper.in","password":"testsub123","role":"subadmin","modules":["Vendors"],"scope":"own"}' | jq -c .

SUB_TOKEN=$(curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"testsub@getdeveloper.in","password":"testsub123"}' | jq -r .token)
echo "=== subadmin (Vendors only) can access vendors ==="; curl -s --max-time 5 -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:3000/api/vendors -H "Authorization: Bearer $SUB_TOKEN"
echo "=== subadmin (Vendors only) forbidden from resumes ==="; curl -s --max-time 5 -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:3000/api/candidates -H "Authorization: Bearer $SUB_TOKEN"
echo "=== subadmin forbidden from creating users (no Recruiters module) ==="; curl -s --max-time 5 -X POST http://127.0.0.1:3000/api/users -H "Authorization: Bearer $SUB_TOKEN" -H 'Content-Type: application/json' -d '{"name":"X","email":"x@getdeveloper.in","password":"password1","role":"recruiter"}' | jq -c .

kill $API_PID $PG_PID 2>/dev/null || true
echo "ALL DONE"
