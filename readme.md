## nextdiff

Github action for nextjs projects.

It takes a **screenshot of your changed pages** and comments on commit.

### usage

```h
workflow "diff" {
  resolves = "nextdiff"
  on = "deployment_status"
}

action "nextdiff" {
  uses = "lucleray/nextdiff@master"
  secrets = ["GITHUB_TOKEN","ZEIT_TOKEN"]
}
```

In the above code snippet, note:

- we are using the `deployment_status` event
- the `ZEIT_TOKEN` and `GITHUB_TOKEN` secrets needs to be added

This action uses the deployments that are created on the github repository (you can see them in the _environment_ tab in your repository). Many integrations are already doing that for you : ZEIT Now for github, Github Pages, ...

### example

See this repository : [next-diff-example](https://github.com/lucleray/nextdiff-example).
