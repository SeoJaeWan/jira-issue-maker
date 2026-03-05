# jira-issue-maker

사용자의 요청이나 Markdown 문서를 Jira 이슈로 등록하는 Claude Code 플러그인입니다.

## 설치

### 마켓플레이스를 통한 설치 (권장)

```bash
# 1. 마켓플레이스 추가
/plugin marketplace add SeoJaeWan/jira-issue-maker

# 2. 플러그인 설치
/plugin install jira-issue-maker@jira-issue-maker
```

### CLI를 통한 설치

```bash
claude plugin add --from https://github.com/SeoJaeWan/jira-issue-maker
```

설치하면 `jira` 스킬과 `atlassian-rovo` MCP 서버가 자동으로 등록됩니다.

### Atlassian 인증

플러그인 설치 후 최초 사용 시 Atlassian OAuth 인증이 필요합니다.
Claude Code에서 Jira 관련 요청을 하면 브라우저 인증 URL이 표시됩니다. 로그인 후 권한을 승인하세요.

### 연결 확인

```
"Jira MCP 연결 상태 확인해줘"
"접근 가능한 Jira 프로젝트 목록 보여줘"
```

## 호출 방법

Claude Code에서 자연어로 요청하면 자동 트리거됩니다.

### 대화형 요청

별도의 문서 없이 대화로 이슈를 만들 수 있습니다.

```
"로그인 실패 시 에러 메시지 표시하는 이슈 만들어줘"
"결제 모듈에 타임아웃 처리 버그 등록해줘"
"관리자 대시보드에 필터 기능 추가하는 스토리 jira에 등록"
```

Claude가 요청 내용을 기반으로 summary, description, issue type 등을 구성하여 리뷰 MD를 생성합니다.

### MD 파일 기반 일괄 등록

미리 작성한 Markdown 파일로 여러 이슈를 한번에 등록할 수도 있습니다.

```
"이 MD 파일로 Jira 이슈 일괄 등록"
"사용자 스토리를 Jira에 등록해줘"
"스토리 등록해줘"
```

이 경우 입력 Markdown은 `## ` 헤딩 단위로 스토리를 구분하며, 각 스토리에 summary와 description이 포함되어야 합니다.

## 워크플로우 (2-Phase Gate)

```
Phase A: prepare ──→ 리뷰 MD 생성 ──→ 사용자 검토/편집 ──→ Phase B: apply ──→ Jira 이슈 생성
```

1. **prepare** — 입력 MD를 파싱하여 리뷰용 MD 파일 생성 (`.ai/jira-review/{task}/{task}.md`)
2. **사용자 검토** — 생성된 리뷰 MD에서 각 스토리의 `status`를 `approved` 또는 `rejected`로 변경
3. **apply** — `approved` 항목만 Jira에 등록, 결과를 리뷰 MD에 반영

> **안전장치**: 사용자의 명시적 승인 없이는 Jira 이슈를 생성하지 않습니다.

## 플러그인 구조

```
jira-issue-maker/
├── .claude-plugin/                       # 플러그인 메타데이터
│   ├── plugin.json                      # 플러그인 매니페스트
│   └── marketplace.json                 # 마켓플레이스 카탈로그
├── README.md                             # 이 문서
├── .mcp.json                             # MCP 서버 자동 등록 (atlassian-rovo)
└── skills/
    └── jira/
        ├── SKILL.md                      # 스킬 계약서 (Claude가 읽는 실행 지침)
        ├── projects/                     # 프로젝트별 규칙 설정
        │   ├── _base.yaml               # 기본 규칙 (모든 프로젝트 공통)
        │   └── DEMO.yaml               # 프로젝트별 오버라이드 예시
        ├── references/                   # Claude가 필요 시 참조하는 상세 문서
        │   ├── md-schema.md             # 리뷰 MD 스키마 정의
        │   ├── field-mapping.md         # MD 필드 → Jira API 필드 매핑
        │   └── duplicate-policy.md      # 중복 감지 정책 상세
        └── scripts/                     # Node.js 실행 스크립트
            ├── prepare.mjs              # Phase A: 리뷰 MD 생성
            ├── apply.mjs               # Phase B: 검증/프리뷰 후 JSON 출력
            └── common/                  # 공유 모듈
                ├── parser.mjs           # 입력 MD 파서
                ├── infer-issue-type.mjs # 이슈 타입 추론 (Story/Bug/Task)
                ├── transform-to-yaml.mjs # 리뷰 MD → 구조화 데이터 변환
                └── yaml-utils.mjs       # 프로젝트 규칙 YAML 파서
```

## 파일별 상세

### `.claude-plugin/plugin.json`
플러그인의 이름, 버전, 설명 등 메타데이터를 정의하는 매니페스트 파일입니다. `skills/`와 `.mcp.json`은 기본 위치에 있으므로 자동 검색됩니다.

### `.claude-plugin/marketplace.json`
이 저장소를 마켓플레이스로 등록할 수 있게 하는 카탈로그 파일입니다. 버전 업데이트 시 `plugin.json`의 `version`이 우선 적용됩니다.

### `.mcp.json`
플러그인 설치 시 `atlassian-rovo` MCP 서버를 자동 등록합니다. 수동으로 MCP를 추가할 필요가 없습니다.

### `SKILL.md`
Claude가 스킬 트리거 시 읽는 실행 지침서입니다. 워크플로우 단계, MCP 도구 매핑, 가드레일 등을 정의합니다. 직접 수정하면 Claude의 실행 동작이 바뀝니다.

### `projects/`
프로젝트별 Jira 설정 규칙입니다.

- **`_base.yaml`** — 필수 필드, 중복 정책, 기본 이슈 타입/우선순위 등 공통 기본값
- **`{KEY}.yaml`** — 프로젝트별 오버라이드 (허용 라벨, 커스텀 필드 매핑, 검증 규칙 등)

### `references/`
Claude가 작업 중 필요할 때 참조하는 상세 문서입니다. 평소에는 컨텍스트에 로드되지 않습니다.

| 파일 | 내용 |
|------|------|
| `md-schema.md` | 리뷰 MD의 YAML front matter, 스토리 섹션, 필드 테이블, status 값 등 스키마 정의 |
| `field-mapping.md` | MD 필드명과 Jira API 필드(표준/커스텀) 간 매핑 규칙 |
| `duplicate-policy.md` | 중복 감지 방식(story_id 기반 JQL), skip/warn/block 정책 동작 상세 |

### `scripts/`
Node.js ESM 모듈로 작성된 실행 스크립트입니다. 외부 npm 의존성 없이 Node.js 내장 모듈만 사용합니다.

| 스크립트 | 역할 |
|----------|------|
| `prepare.mjs` | 입력 MD 파싱 → 이슈 타입 추론 → 리뷰 MD 생성 |
| `apply.mjs` | 리뷰 MD 읽기 → approved 항목 검증 → JSON 출력 (실제 Jira 호출은 Claude가 MCP로 수행) |

| 공유 모듈 | 역할 |
|-----------|------|
| `parser.mjs` | `## ` 헤딩 기반 스토리 파싱, 필수 필드 검증 |
| `infer-issue-type.mjs` | summary/description 키워드 기반 Bug/Task/Story 분류 (한/영 지원) |
| `transform-to-yaml.mjs` | 리뷰 MD에서 승인된 항목 추출 및 구조화 |
| `yaml-utils.mjs` | 프로젝트 규칙 YAML 파싱, base + project 병합 |

## 산출물

리뷰 MD는 `.ai/jira-review/{task}/{task}.md` 경로에 생성됩니다.

```
.ai/jira-review/
└── 불법주정차탐지/
    └── 불법주정차탐지.md
```

## 프로젝트 템플릿 추가

새 Jira 프로젝트를 등록 대상에 추가하려면 `projects/{KEY}.yaml` 파일이 필요합니다.
Claude에게 직접 생성을 요청할 수 있습니다.

### Claude에게 요청하는 방법

```
"WEB 프로젝트 템플릿 만들어줘"
"MOBILE 프로젝트용 jira 규칙 파일 생성해줘"
"DEMO.yaml 참고해서 API 프로젝트 설정 만들어줘"
```

Claude가 Jira MCP를 통해 해당 프로젝트의 이슈 타입, 필드, 라벨 등을 자동 조회한 뒤 `projects/{KEY}.yaml`을 생성합니다.

### 직접 만드는 방법

`DEMO.yaml`을 복사하여 프로젝트 키에 맞게 수정합니다.

```bash
cp projects/DEMO.yaml projects/WEB.yaml
```

주요 설정 항목:

```yaml
project_key: "WEB"                    # Jira 프로젝트 키

required_fields:                      # 필수 필드 목록
  - summary
  - description
  - issuetype
  - labels
  - story_id
  - priority

allowed_labels:                       # 허용 라벨 (빈 배열 = 제한 없음)
  - frontend
  - backend

story_id_default_prefix: "WEB"        # 자동 생성 story ID 접두어
default_epic: "WEB-100"               # 기본 에픽 키 (빈 문자열 = 매번 선택)
duplicate_policy: "warn"              # skip | warn | block

custom_field_mapping:                 # 논리 필드명 → Jira 커스텀 필드 ID
  story_id: "customfield_10100"
  component: "customfield_10200"

validation_rules:                     # 입력값 검증 규칙
  summary_min_length: 10
  summary_max_length: 120
```

> `_base.yaml`에 정의된 값은 프로젝트 파일에서 재정의하지 않는 한 그대로 적용됩니다.
> 기본값과 동일한 항목은 생략해도 됩니다.

## 커스터마이징

| 변경하고 싶은 것 | 수정할 파일 |
|------------------|-------------|
| 필수 필드 추가/제거 | `projects/_base.yaml` → `required_fields` |
| 프로젝트별 라벨 제한 | `projects/{KEY}.yaml` → `allowed_labels` |
| 커스텀 필드 매핑 | `projects/{KEY}.yaml` → `custom_field_mapping` |
| 중복 정책 기본값 | `projects/_base.yaml` → `duplicate_policy` |
| 이슈 타입 추론 키워드 | `scripts/common/infer-issue-type.mjs` |
| 워크플로우 단계 변경 | `SKILL.md` |
