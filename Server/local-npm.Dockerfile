# local dockerfile that use npm to install citrineos core and then build the ocpi server

FROM --platform=$BUILDPLATFORM node:24 AS build

WORKDIR /usr/local/apps

COPY ./citrineos-ocpi ./citrineos-ocpi
COPY ./citrineos-ocpi/Server/tsconfig.docker.json /usr/local/apps/citrineos-ocpi/Server/tsconfig.json

WORKDIR /usr/local/apps/citrineos-ocpi

# INSTALL
RUN npm run install-all

# BUILD
RUN npm run build

# The final stage, which copies built files and prepares the run environment
# Using alpine image to reduce the final image size
FROM --platform=$BUILDPLATFORM node:24-alpine
COPY --from=build /usr/local/apps /usr/local/apps

WORKDIR /usr/local/apps/citrineos-ocpi

EXPOSE ${PORT}

CMD ["npm", "run", "start-docker"]
