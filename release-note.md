# day 1 - working, nothing publishes

git add . && git commit -m "add http module"
git push origin master

# day 5 - still working, nothing publishes

git add . && git commit -m "add store module"
git push origin master

# day 10 - ready to release, NOW it publishes

git add . && git commit -m "release v0.0.2"
git tag v0.0.2
git push origin master --tags

# Delete tag
git tag -d v0.0.3 #local_delete
git push origin --delete v0.0.3 #remote_delete
