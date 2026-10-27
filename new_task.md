==> Cloning from https://github.com/haXorFalcon/nsa
==> Checking out commit 51fb32f5ed685ae034a39e37b2cfeadc2af18cca in branch main
==> Using Python version 3.11.9 via environment variable PYTHON_VERSION
==> Docs on specifying a Python version: https://render.com/docs/python-version
==> Installing Python version 3.11.9...
==> Using Poetry version 2.1.3 (default)
==> Docs on specifying a Poetry version: https://render.com/docs/poetry-version
==> Running build command 'npm install && npm install @rolldown/binding-linux-x64-gnu@1.2.15 lightningcss-linux-x64-gnu@1.33.0 --no-save && (cd frontend && npm install @rolldown/binding-linux-x64-gnu@1.2.15 lightningcss-linux-x64-gnu@1.33.0 --no-save) && npm run build && pip install -r requirements.txt'...
==> Using Node.js version 20.12.0 via environment variable NODE_VERSION
==> Docs on specifying a Node.js version: https://render.com/docs/node-version
==> Installing Node.js version 20.12.0...

added 36 packages, and audited 38 packages in 2s

10 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

added 2 packages, and audited 40 packages in 687ms

11 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

up to date, audited 40 packages in 468ms

11 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

> helios-spaceapps-challenge@1.0.0 build
> npm --prefix frontend run build


> frontend@0.0.0 build
> tsc -b && vite build

node:util:210
    validateOneOf(format, 'format', ObjectKeys(inspect.colors));
    ^

TypeError [ERR_INVALID_ARG_VALUE]: The argument 'format' must be one of: 'reset', 'bold', 'dim', 'italic', 'underline', 'blink', 'inverse', 'hidden', 'strikethrough', 'doubleunderline', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'bgBlack', 'bgRed', 'bgGreen', 'bgYellow', 'bgBlue', 'bgMagenta', 'bgCyan', 'bgWhite', 'framed', 'overlined', 'gray', 'redBright', 'greenBright', 'yellowBright', 'blueBright', 'magentaBright', 'cyanBright', 'whiteBright', 'bgGray', 'bgRedBright', 'bgGreenBright', 'bgYellowBright', 'bgBlueBright', 'bgMagentaBright', 'bgCyanBright', 'bgWhiteBright'. Received [ 'underline', 'gray' ]
    at styleText (node:util:210:5)
    at styleText$1 (file:///opt/render/project/src/node_modules/rolldown/dist/shared/create-bundler-option-DzNR1xQS.mjs:1321:9)
    at file:///opt/render/project/src/node_modules/rolldown/dist/shared/create-bundler-option-DzNR1xQS.mjs:1589:156
    at ModuleJob.run (node:internal/modules/esm/module_job:222:25)
    at async ModuleLoader.import (node:internal/modules/esm/loader:323:24) {
  code: 'ERR_INVALID_ARG_VALUE'
}

Node.js v20.12.0
==> Build failed 😞
==> Common ways to troubleshoot your deploy: https://render.com/docs/troubleshooting-deploys
==> Using Node.js version 20.12.0 via environment variable NODE_VERSION
==> Docs on specifying a Node.js version: https://render.com/docs/node-version