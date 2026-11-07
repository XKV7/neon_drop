#!/usr/bin/env bash
# 게임 서버를 Cloud Run에 배포한다. 사용: PROJECT_ID=내프로젝트 ./scripts/deploy-cloudrun.sh
set -euo pipefail
: "${PROJECT_ID:?PROJECT_ID 환경 변수에 Firebase 프로젝트 ID를 넣으세요}"
REGION="${REGION:-asia-northeast3}"   # 서울
SERVICE="${SERVICE:-neon-drop}"
ORIGINS="${ALLOWED_ORIGINS:-https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com}"

# 매치·로비 상태는 서버 메모리에 있으므로 인스턴스는 정확히 1개 (--max-instances 1)
# ALLOWED_ORIGINS 값에 쉼표가 있으므로 --set-env-vars 구분자를 | 로 바꾼다 (^|^ 접두어)
# WebSocket 연결을 오래 유지하도록 요청 제한 시간 60분, 연결 사이에도 게임 루프가 돌도록 CPU 상시 할당
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" --source . \
  --allow-unauthenticated \
  --max-instances 1 --min-instances 0 \
  --concurrency 250 --timeout 3600 --session-affinity \
  --no-cpu-throttling --cpu 1 --memory 512Mi \
  --set-env-vars "^|^STORE=firestore|FIRESTORE_PROJECT_ID=${PROJECT_ID}|ALLOWED_ORIGINS=${ORIGINS}"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
echo
echo "게임 서버 주소: $URL"
echo "상태 확인:      $URL/health"
echo "다음 단계: client/.env.production 에  VITE_SERVER_URL=$URL  를 넣고  npm run deploy:hosting"
