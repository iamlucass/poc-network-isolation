# Network Isolation PoC

An experimental approach to isolating a Node.js service's network access using
Docker networking and nginx as an egress proxy.

<details>
<summary>Expand: <strong>Table of Contents</strong></summary>

## Table of Contents

- [Network Isolation PoC](#network-isolation-poc)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
    - [Start the services](#start-the-services)
    - [What Fails: Bypassing the Proxy](#what-fails-bypassing-the-proxy)
    - [What Works: Using the Proxy](#what-works-using-the-proxy)
    - [Key Takeaway](#key-takeaway)
  - [The Core Idea](#the-core-idea)
  - [How It Works](#how-it-works)
    - [Network Architecture](#network-architecture)
    - [Key Components](#key-components)
  - [Try It Yourself](#try-it-yourself)
    - [Prerequisites](#prerequisites)
    - [Running the PoC](#running-the-poc)
    - [Expected Behavior](#expected-behavior)
    - [Experiment Further](#experiment-further)
  - [Security Mechanisms Demonstrated](#security-mechanisms-demonstrated)
  - [Limitations \& Non-Goals](#limitations--non-goals)
  - [Production Equivalents](#production-equivalents)
    - [Kubernetes](#kubernetes)
    - [AWS](#aws)
    - [Service Mesh (Istio)](#service-mesh-istio)
    - [Other Tools](#other-tools)
  - [Learning Path](#learning-path)
  - [Why This Matters](#why-this-matters)
  - [Threat Model](#threat-model)
  - [Contributing](#contributing)
  - [License](#license)
  - [Acknowledgments](#acknowledgments)

</details>

## Quick Start

### Start the services

Start the services using Docker Compose:

```sh
docker compose up -d
```

### What Fails: Bypassing the Proxy

Requesting `/google` attempts to access `https://google.com` directly, bypassing
the nginx proxy. Since the Node.js container runs in an isolated network with no
direct internet access, this fails:

```sh
$ curl http://localhost:3000/google
{"err":"Unable to connect. Is the computer able to access the url?"}
```

This demonstrates the network isolation in action-even though the code tries to
make the request, the network layer blocks it.

### What Works: Using the Proxy

The `/github` and `/stripe` endpoints route through nginx, which has access to
both the internal network and the internet:

```sh
$ curl http://localhost:3000/github
{
  "current_user_url": "https://api.github.com/user",
  "current_user_authorizations_html_url": "https://github.com/settings/connections/applications{/client_id}",
  "authorizations_url": "https://api.github.com/authorizations",
  "code_search_url": "https://api.github.com/search/code?q={query}{&page,per_page,sort,order}",
  "commit_search_url": "https://api.github.com/search/commits?q={query}{&page,per_page,sort,order}",
...
```

The request flow: `curl` → `nginx:3000` → `node:3000` → `nginx:80` (as
`github.lokal`) → `api.github.com` → response back through the chain.

### Key Takeaway

The application code is identical for both requests-both use `fetch()`. The
difference is the network topology: one path is blocked by infrastructure, the
other is explicitly allowed. The application doesn't enforce this policy; the
network does.

## The Core Idea

**What if your application couldn't reach the internet at all-except through
explicit gateways you control?**

Instead of trusting your application code to "do the right thing," the network
itself enforces which external services can be accessed. Even if your
application is compromised, an attacker cannot:

- Exfiltrate data to arbitrary domains
- Download malicious payloads from the internet
- Participate in DDoS attacks
- Connect to command & control servers

This PoC demonstrates this concept using standard Docker networking and nginx as
a reverse proxy.

## How It Works

```txt
┌─────────────────────────────────────────┐
│  External Network (Internet)            │
└─────────────────┬───────────────────────┘
                  │
                  │ :3000
┌─────────────────▼───────────────────────┐
│  nginx (Egress Proxy)                   │
│  - Exposes app on port 3000             │
│  - Routes to api.github.com             │
│  - Routes to api.stripe.com             │
└─────────────────┬───────────────────────┘
                  │
                  │ Internal Network Only
┌─────────────────▼───────────────────────┐
│  Node.js App                            │
│  - No direct internet access            │
│  - Can only reach allowed domains       │
│    through nginx proxy                  │
└─────────────────────────────────────────┘
```

### Network Architecture

1. **Internal Network (`node`)**: The Node.js service runs in an isolated Docker
   network with `internal: true`, which prevents any direct internet access
2. **Nginx as Gateway**: Nginx bridges the internal network and external
   network, acting as a controlled egress point
3. **Explicit Allowlist**: Only domains configured in `nginx.conf` are
   accessible to the Node.js service

### Key Components

**Docker Compose (`docker-compose.yml`):**

- Creates an internal network that blocks all outbound internet access
- Runs the Node.js app with dropped capabilities and non-root user
- Runs nginx with access to both networks

**Nginx Configuration (`nginx/nginx.conf`):**

- Defines explicit proxy rules for allowed external services (GitHub, Stripe)
- Exposes the application to external clients on port 3000

**Node.js Application (`node/index.ts`):**

- Demonstrates successful requests through the proxy (`/github`, `/stripe`)
- Demonstrates failed requests that bypass isolation (`/google`)

## Try It Yourself

### Prerequisites

- Docker and Docker Compose
- Bun runtime (or modify to use Node.js)

### Running the PoC

```bash
# Clone the repository
git clone <your-repo-url>
cd network-isolation-poc

# Start the services
docker-compose up --build

# In another terminal, test the endpoints
curl http://localhost:3000/github   # ✅ Works - goes through proxy
curl http://localhost:3000/stripe   # ✅ Works - goes through proxy
curl http://localhost:3000/google   # ❌ Fails - bypasses isolation
```

### Expected Behavior

- **`/github` and `/stripe`**: Successfully fetch data through the nginx proxy
- **`/google`**: Times out or fails because it tries to connect directly to the
  internet, which is blocked

### Experiment Further

**Add a new allowed service:**

1. Add a proxy rule to `nginx/nginx.conf`:

```nginx
server {
  listen 80;
  server_name openai.lokal;

  location / {
    proxy_pass https://api.openai.com;
    proxy_ssl_server_name on;
    proxy_set_header Host api.openai.com;
  }
}
```

2. Add the alias to nginx networks in `docker-compose.yml`:

```yaml
nginx:
  networks:
    node:
      aliases:
        - stripe.lokal
        - github.lokal
        - openai.lokal # Add this
```

3. Use it in your Node.js code:

```typescript
"/openai": () => proxy("http://openai.lokal").catch(errorResponse),
```

4. Restart and test:

```bash
docker-compose down && docker-compose up --build
curl http://localhost:3000/openai
```

**Try to bypass the isolation:**

Modify the Node.js code to request `https://amazon.com` directly and observe it
fail. This demonstrates that even if application code is modified (or
compromised), the network boundary enforces the policy.

## Security Mechanisms Demonstrated

This PoC implements several defense-in-depth principles:

- **Network Segmentation**: Internal network isolation prevents direct internet
  access
- **Explicit Allowlisting**: Only pre-approved domains are reachable
- **Least Privilege**: Containers run as non-root users with all capabilities
  dropped
- **Immutable Configuration**: Nginx config is mounted read-only
- **Ephemeral Storage**: Uses tmpfs for temporary files

## Limitations & Non-Goals

This is intentionally simplified for educational purposes. It does **not**
address:

- **SSRF to allowed domains**: If GitHub API is vulnerable, the app can exploit
  it
- **Rate limiting**: No request throttling or abuse prevention
- **Authentication**: No verification of requests through the proxy
- **High availability**: Single nginx instance, no failover
- **Monitoring**: No metrics, logging, or alerting
- **DNS security**: Uses public DNS resolvers without validation
- **Memory/resource management**: No production-grade error handling or resource
  limits
- **Performance optimization**: No connection pooling, caching, or optimization
- **Dynamic configuration**: Changes require nginx restart
- **Protocol restrictions**: Doesn't support other protocols, which may need a
  change in using `nginx`

## Production Equivalents

In real-world environments, use purpose-built tools:

### Kubernetes

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-egress-except-approved
spec:
  podSelector:
    matchLabels:
      app: myapp
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: approved-gateway
```

### AWS

- **VPC Security Groups**: Control egress traffic at the instance level
- **VPC Endpoints**: Private connections to AWS services
- **NAT Gateway with route tables**: Control internet-bound traffic
- **AWS Network Firewall**: Stateful inspection of egress traffic

### Service Mesh (Istio)

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: ServiceEntry
metadata:
  name: external-github
spec:
  hosts:
    - api.github.com
  ports:
    - number: 443
      name: https
      protocol: HTTPS
  location: MESH_EXTERNAL
```

### Other Tools

- **Cilium**: eBPF-based network policies
- **Calico**: Advanced network policy engine
- **Squid/Proxy**: Traditional forward proxy with ACLs
- **Cloud NAT**: Google Cloud's managed NAT service

## Learning Path

If this concept interests you, explore:

1. **Docker Networking**: Bridge networks, overlay networks, network drivers
2. **Kubernetes NetworkPolicies**: Pod-level network segmentation
3. **Service Mesh Architecture**: Envoy, Istio, Linkerd
4. **Zero Trust Networking**: BeyondCorp, identity-based access
5. **Container Security**: AppArmor, SELinux, seccomp profiles

## Why This Matters

Many developers treat network access as binary: "connected to internet" or "not
connected." This PoC demonstrates that **the network topology itself can be a
security control**.

When building microservices or handling sensitive data, consider:

- Does this service really need internet access?
- Can I limit it to specific domains?
- What happens if this service is compromised?

Network isolation is one layer in a defense-in-depth strategy. It won't stop all
attacks, but it significantly raises the bar for attackers.

## Threat Model

**What this protects against:**

- Compromised dependencies making unauthorized network requests
- Malicious code exfiltrating data to attacker-controlled domains
- Participating in botnet activities or DDoS attacks
- Downloading additional payloads after initial compromise

**What this doesn't protect against:**

- Attacks using allowed services as intermediaries
- Vulnerabilities in the allowed external APIs
- Application-layer attacks that don't require network access
- Supply chain attacks in the base images or dependencies
- Attacks that occur before the network policy is applied

## Contributing

This is an experimental educational project. Contributions welcome for:

- Alternative implementations (Kubernetes, cloud-specific examples)
- Additional documentation or diagrams
- Bug fixes or improvements to the demo
- Real-world case studies or war stories

Please note: This is intentionally kept simple. Feature requests that add
significant complexity may be declined to preserve the educational clarity.

## License

MIT License - feel free to use this for learning, teaching, or as a starting
point for your own experiments.

## Acknowledgments

Inspired by real-world network isolation patterns used in:

- Banking and financial services infrastructure
- Healthcare systems handling PHI
- Government systems with classified data
- High-security SaaS platforms

The principle is simple: **Don't trust your code. Trust your infrastructure.**
