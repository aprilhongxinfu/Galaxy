# Using the GitHub Container Registry for Deployment

1. Create a personal token: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

```
docker login ghcr.io --username github-account
[Paste your GitHub token on this prompt]
```

2. Build the image for the server

```
docker image build --platform linux/amd64 -t galaxy .
```

2. Tag and push your Docker images

```
docker tag galaxy ghcr.io/eth-peach-lab/galaxy/galaxy:latest
docker push ghcr.io/eth-peach-lab/galaxy/galaxy:latest
```