// 워커 스레드에서 TypeScript 소스를 실행하기 위한 부트스트랩
import { register } from 'tsx/esm/api';
register();
await import('./balanceWorker.ts');
