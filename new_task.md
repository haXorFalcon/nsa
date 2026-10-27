==> Cloning from https://github.com/haXorFalcon/nsa
==> Checking out commit 51fb32f5ed685ae034a39e37b2cfeadc2af18cca in branch main
==> Using Python version 3.11.9 via environment variable PYTHON_VERSION
==> Docs on specifying a Python version: https://render.com/docs/python-version
==> Installing Python version 3.11.9...
==> Using Poetry version 2.1.3 (default)
==> Docs on specifying a Poetry version: https://render.com/docs/poetry-version
==> Running build command 'cd frontend && npm install && npm install @rolldown/binding-linux-x64-gnu@1.2.15 lightningcss-linux-x64-gnu@1.33.0 --no-save && npm run build && cd .. && pip install -r requirements.txt'...
==> Using Node.js version 20.12.0 via environment variable NODE_VERSION
==> Docs on specifying a Node.js version: https://render.com/docs/node-version
==> Installing Node.js version 20.12.0...

added 36 packages, and audited 38 packages in 2s

10 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

added 1 package, and audited 39 packages in 580ms

11 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

> frontend@0.0.0 build
> tsc -b && vite build

file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:601
			const error = /* @__PURE__ */ new Error("Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both package-lock.json and node_modules directory.");
			                              ^

Error: Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both package-lock.json and node_modules directory.
    at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:601:34
    at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:9:49
    ... 2 lines matching cause stack trace ...
    at async ModuleLoader.import (node:internal/modules/esm/loader:323:24) {
  cause: Error: Cannot find module '@rolldown/binding-wasm32-wasi'
  Require stack:
  - /opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs
      at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:495:18
      ... 6 lines matching cause stack trace ...
      at async ModuleLoader.import (node:internal/modules/esm/loader:323:24) {
    cause: Error: Cannot find module './rolldown-binding.wasi.cjs'
    Require stack:
    - /opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs
        at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:495:18
        ... 6 lines matching cause stack trace ...
        at async ModuleLoader.import (node:internal/modules/esm/loader:323:24) {
      cause: Error: Cannot find module '@rolldown/binding-linux-x64-gnu'
      Require stack:
      - /opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs
          at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:495:18
          ... 6 lines matching cause stack trace ...
          at async ModuleLoader.import (node:internal/modules/esm/loader:323:24) {
        cause: Error: Cannot find module '../rolldown-binding.linux-x64-gnu.node'
        Require stack:
        - /opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs
            at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:495:18
            at Array.reduce (<anonymous>)
            at createLoadErrorChain (file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:488:17)
            at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:602:18
            at file:///opt/render/project/src/node_modules/rolldown/dist/shared/binding-BMtuZhvP.mjs:9:49
            at file:///opt/render/project/src/node_modules/rolldown/dist/shared/parse-B7LUicIJ.mjs:3:46
            at ModuleJob.run (node:internal/modules/esm/module_job:222:25)
            at async ModuleLoader.import (node:internal/modules/esm/loader:323:24) {
          cause: null
        }
      }
    }
  }
}

Node.js v20.12.0
npm ERR! Lifecycle script `build` failed with error: 
npm ERR! Error: command failed 
npm ERR!   in workspace: frontend@0.0.0 
npm ERR!   at location: /opt/render/project/src/frontend 
==> Build failed 😞
==> Common ways to troubleshoot your deploy: https://render.com/docs/troubleshooting-deploys
==> Using Node.js version 20.12.0 via environment variable NODE_VERSION
==> Docs on specifying a Node.js version: https://render.com/docs/node-version