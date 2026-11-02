# 마작귀 런처 (Majakgwi Launcher)

마작귀 서버(`117.110.40.130:25565`) 전용 커스텀 런처.
[Helios Launcher](https://github.com/dscalzi/HeliosLauncher) 기반이며, 모드·설정·Java 를
자동으로 관리한다. 플레이어는 설치 파일 하나만 받으면 되고, 모드를 직접 넣을 필요가 없다.

- 최신 빌드: **1.0.3** (`MajakgwiLauncher-1.0.3-win64.zip`, 147,182,934 B, sha256 `3195fe5a…02390a`)
- 다운로드: [**Release v1.0.3**](https://github.com/wwa171/majakgwi-launcher/releases/tag/v1.0.3)
- 배포 위치: [`wwa171/NB-Server` Releases — `latest` 태그](https://github.com/wwa171/NB-Server/releases/tag/latest)
- 참고: 저장소가 현재 **비공개**라 위 다운로드 링크는 GitHub 로그인 후 열린다. 플레이어 배포에는 공개 전환 또는 별도 공개 배포 저장소가 필요하다.
- 대상 환경: Windows x64, Minecraft 26.3 / Fabric 0.20.1

---

## 1. 플레이어용

### 1.1 설치

1. Releases 에서 `MajakgwiLauncher-<버전>-win64.zip` 을 받는다.
2. 원하는 폴더에 압축을 푼다. (설치 프로그램 없음 — 풀면 끝)
3. `MajakgwiLauncher.exe` 를 실행한다.

Microsoft 계정 로그인은 Minecraft 계정으로 진행한다. 런처는 계정 정보를 저장하지 않는다.

### 1.2 첫 실행에서 일어나는 일

런처는 시작할 때 **`distribution.json`** 을 내려받아, 그 안에 나열된 모드·라이브러리를
`common/modstore/` 에 받고 `instances/<id>/forgeMods.list` 를 다시 쓴다.
즉 "모드를 넣는 것"과 "목록에 등록하는 것"이 한 번에 처리된다.

첫 실행은 모드 용량 때문에 시간이 걸린다. 두 번째부터는 바뀐 것만 받는다.

### 1.3 접속

서버 선택 목록에 마작귀 서버가 기본으로 들어 있다. `플레이` 를 누르면 접속된다.

### 1.4 문제 해결

| 증상 | 원인 | 조치 |
|---|---|---|
| `Received unknown remote registry entries from server` / `Registry remapping failed!` | jar 는 있는데 `forgeMods.list` 에 없음 | 런처를 다시 실행해 목록 재생성. 손으로 목록을 고쳐도 실행 시 덮어써진다 |
| 실행 직후 종료, Java 관련 오류 | JDK 미탑재 또는 버전 불일치 | 런처가 JDK 를 자동 배치한다. 백신이 `jdk` 폴더를 격리했는지 확인 |
| `UnsatisfiedLinkError` / LWJGL 오류 | 네이티브 라이브러리 불일치 | 런처를 최신 버전으로 재설치. 구버전 zip 이 섞이지 않게 폴더를 새로 푼다 |
| 서버 주소가 예전 것 | 매니페스트가 오래됨 | 런처 재시작(시작 시 `distribution.json` 을 다시 pull). 그래도 같으면 매니페스트 커밋 문제 |

런처는 **모드를 내장하지 않는다.** 모드 문제는 거의 항상 매니페스트나 목록 문제이지
런처 바이너리 문제가 아니다. 그래서 대부분의 수정은 재빌드가 아니라 `distribution.json` 커밋으로 끝난다.

---

## 2. 구조

```
플레이어 PC
  └ MajakgwiLauncher.exe
       ├ distribution.json 내려받기 (NB-Server, main 브랜치)
       ├ artifact.url → GitHub Release 자산 다운로드
       ├ artifact.MD5 검증
       └ instances/<id>/forgeMods.list 재생성 → 게임 실행
```

`distribution.json` 이 **단일 진실 공급원**이다. 런처 화면에 옛 서버 주소가 보이면
런처가 아니라 매니페스트가 오래된 것이다.

### 2.1 `distribution.json` 에서 버전을 올릴 때 같이 바꿀 것

| 위치 | 놓치면 |
|---|---|
| 최상위 `version`, `servers[].version` | 런처가 업데이트로 인식하지 못함 |
| 모듈 `id` 의 버전 suffix | 구버전으로 판단 |
| `artifact.size`, `artifact.MD5` | 무결성 검증 실패 |
| `artifact.url` 파일명 | 404 |

MD5 는 **소문자 32자**로 넣는다. 서버 jar 와 클라이언트 jar 는 같은 빌드여야 한다 —
한쪽만 올리면 레지스트리 불일치로 접속이 막힌다.

---

## 3. 소스 빌드 (개발자용)

### 3.1 준비

- Node.js (`.nvmrc` 참조), npm
- Windows x64 (electron-builder zip 타깃)

```bash
npm install
```

### 3.2 마작귀 브랜딩이 들어간 파일

| 파일 | 내용 |
|---|---|
| `app/assets/js/distromanager.js` | `REMOTE_DISTRO_URL` — 매니페스트 주소 |
| `app/assets/lang/_custom.toml` | 창 제목, 환영 문구, 링크. 한국어 UI |
| `build/icon.png` | 256×256 아이콘 |
| `electron-builder.yml` | `appId`, `productName`, zip 타깃 |
| `package.json` | `name`, `version`, `description`, `author` |
| `index.js` | 메인 프로세스 부트스트랩 (JDK 배치, LWJGL 네이티브 주입) |

`index.js` 의 부트스트랩이 핵심이다. Helios 는 26.x 를 완전히 지원하지 않아
**JDK 다운로드와 LWJGL 네이티브 처리**를 직접 고쳐야 한다. 이 부분이 없으면
친구 PC 마다 Java 버전·네이티브 오류가 터진다.

### 3.3 빌드

```bash
npm run dist
```

산출물은 `dist/` 에 생긴다. zip 을 Release 자산으로 올리면 배포 끝이다.

---

## 4. 배포 절차

1. 빌드 산출물 zip 을 Release 에 업로드
   — 같은 이름의 자산이 이미 있으면 **먼저 삭제**해야 한다(Release 자산은 이름 중복 불가)
2. `distribution.json` 의 `version`·모듈 `id`·`size`·`MD5`·`url` 갱신 후 커밋
3. 런처 재시작으로 반영 확인

---

## 5. 버전 이력

| 버전 | 자산 ID | 크기 | 비고 |
|---|---|---|---|
| 1.0.0 | `695288074` | 147,148,979 | 최초 배포. 롤백용 보존 |
| **1.0.1** | `697449951` | 147,182,504 | 현행 |

---

## 6. 라이선스

Helios Launcher 는 MIT 라이선스다. 원본 저장소의 `LICENSE.txt` 를 함께 배포한다.
