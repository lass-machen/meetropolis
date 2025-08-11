FROM node:20-alpine as base
WORKDIR /usr/src/app

COPY ../../package.json ../../package-lock.json* ../../pnpm-lock.yaml* ../../tsconfig.base.json /usr/src/
COPY . /usr/src/app

RUN cd /usr/src && npm i --workspaces=false && cd /usr/src/app && npm i

RUN npm run build

EXPOSE 5173
CMD ["npm", "run", "preview"]

