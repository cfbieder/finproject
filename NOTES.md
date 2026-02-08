
## Linux commmands and scripts



https://fin.tail413695.ts.net/dev


### Deploy scripts

./sync-db-prod-to-dev.sh

./deploy-to-production.sh

### Version Control
    # Patch version (2.0.0 → 2.0.1)
    ./bump-version.sh patch

    # Minor version (2.0.0 → 2.1.0)
    ./bump-version.sh minor

    # Major version (2.0.0 → 3.0.0)
    ./bump-version.sh major

    # Or set a specific version
    ./bump-version.sh 2.1.5


## TMUX
    tmux new -s <name>
    tmux attach -t <name>
    Ctrl+B c


## TO DO ITEMS

    Add option to update budget FX rates on transactions page

    Test to check if fx rates in fc periods work, if changed

    add COA management

    review how income, growth and expense calculated in fcbuilder/ put tooltips

    When copying modules to other scenarios automatically update base date and values

    Export to excel

    Ability to adjust the tax rate on some income (e.g. UB)

    On liabilities the expense needs to a negative percent, can this be fixed

    Add some KPI to Budget Page and Forecast Page with graphics

    Add way to re-export changes back to PS?

    Start on Option Analysis