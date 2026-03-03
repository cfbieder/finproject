
## Linux commmands and scripts

kill -9 $(lsof -t -i :5174)
kill -9 $(lsof -t -i :3105)

https://fin.tail413695.ts.net/dev

pkill -f 'claude.*--output-format stream-json'


### Deploy scripts

./Scripts/sync-db-prod-to-dev.sh

./Scripts/deploy-to-production.sh

### Version Control
    # Patch version (2.0.0 → 2.0.1)
    ./Scripts/bump-version.sh patch

    # Minor version (2.0.0 → 2.1.0)
    ./Scripts/bump-version.sh minor

    # Major version (2.0.0 → 3.0.0)
    ./Scripts/bump-version.sh major

    # Or set a specific version
    ./Scripts/bump-version.sh 2.1.5


## TMUX
    tmux new -s <name>
    tmux attach -t <name>
    Ctrl+B c

## Linux Commands
    docker system prune



## TO DO ITEMS

See [Documentation/PROJECT_ROADMAP.md](Documentation/PROJECT_ROADMAP.md) for the full roadmap, known issues, and improvement proposals.

-- Need to update way that import happens so as not to override changes made locally