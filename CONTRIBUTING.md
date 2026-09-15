# Contributing to Nexus Chat

Thank you for your interest in contributing to **Nexus Chat**! We are building an enterprise-grade, privacy-first, open-source AI collaboration platform. 

Whether you are fixing a bug, adding new features, improving documentation, or optimizing distributed systems performance, we welcome your contributions.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](.github/CODE_OF_CONDUCT.md). Please treat all contributors with respect and professionalism.

---

## How Can I Contribute?

### 1. Reporting Bugs
Before creating an issue, please search the [Issue Tracker](https://github.com/Rajat25022005/Nexus-chat/issues) to verify the bug hasn't already been reported.

When reporting a bug, please use the **Bug Report Template** and include:
* A clear and descriptive title.
* Step-by-step reproduction instructions.
* Expected vs. actual behavior.
* Relevant terminal logs or browser console errors.
* Environment details (OS, Docker version, browser).

### 2. Suggesting Enhancements
Feature requests are tracked via [GitHub Issues](https://github.com/Rajat25022005/Nexus-chat/issues). When suggesting a feature:
* Use the **Feature Request Template**.
* Explain the problem or use case clearly.
* Propose an architectural or UI solution.

### 3. Submitting Code Changes (Pull Requests)
We follow the standard GitHub Fork & Pull Request workflow:

1. **Fork the repository** to your personal GitHub account.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/Nexus-chat.git
   cd Nexus-chat
   ```
3. **Create a topic branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
4. **Make your changes** following our coding standards and guidelines.
5. **Run tests locally** across the affected services (see below).
6. **Commit with Conventional Commits** style:
   ```bash
   git commit -m "feat(api): add multi-workspace member search"
   git commit -m "fix(socket): prevent crash on unauthenticated pong"
   ```
7. **Push to your fork**:
   ```bash
   git push origin feat/your-feature-name
   ```
8. **Open a Pull Request** against the `main` branch of `Rajat25022005/Nexus-chat`. Fill out the PR template completely.

---

## Local Development & Testing

### Prerequisites
* **Docker & Docker Compose** (v20+)
* **Go** 1.22+ (for `nexus-api` and Go microservices)
* **Elixir** 1.14+ & **Erlang/OTP** 25+ (for `nexus-socket`)
* **Node.js** 20+ & **npm** (for React client)
* **Python** 3.12+ (for `nexus-rag`)

### 1. Start Infrastructure
```bash
docker compose up -d postgres redis minio qdrant
```

### 2. Testing `nexus-api` (Go)
```bash
cd services/nexus-api
go test -v ./...
go vet ./...
```

### 3. Testing `nexus-socket` (Elixir)
```bash
cd services/nexus-socket
mix deps.get
mix test
mix format --check-formatted
```

### 4. Testing Client (React 19)
```bash
cd client
npm install
npm run build
```

---

## Commit Message Guidelines

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification:

* `feat(...)`: A new user-facing or API feature
* `fix(...)`: A bug fix
* `docs(...)`: Documentation changes only
* `refactor(...)`: Code change that neither fixes a bug nor adds a feature
* `perf(...)`: Performance optimization
* `test(...)`: Adding or updating tests
* `chore(...)`: Tooling, dependency updates, CI/CD changes

**Examples**:
- `feat(socket): add channel presence broadcast with delta-crdt`
- `fix(api): handle postgres 23505 race condition on direct chat`
- `docs(readme): add docker-compose quickstart instructions`

---

## Pull Request Review Process

1. **Automated Checks**: Your PR will be validated against CI linting and automated tests.
2. **Review**: A maintainer will review your code for design integrity, test coverage, and documentation.
3. **Addressing Feedback**: Push additional commits to your topic branch to update the PR automatically.
4. **Merge**: Once approved, your PR will be squash-merged into `main`.

Thank you for helping make Nexus Chat the best open-source workplace AI platform!
