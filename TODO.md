# Original code from: https://github.com/KasraNezamabadi/ECGAnnotationWebsite
# This repo: https://github.com/hannahbotelho/ECGAnnotationWebsiteV2

# Encapsulate front-end, back-end & mysql db in 3 docker containers.
- [x] Docker: Front-end, back-end & mysql db in containers. (Aug/28/2024)
    - See docker-compose.yml, 2 Dockerfiles and 2 .env files
- [x] Scripts to run on dev env
    - ./build.sh [stop|start|cleanup|build|restart]
- [?] User login system
    - [x] Stores user in mysql table Users, supports annotator_id to distinguish user roles
        - id: 5 for admin (default user admin@example.com)
        - id: 6 for checker (default user checker@example.com)
        - id: 8 for annotator (default user annotator@example.com)
    - [ ] Hardcode users from Goals.md
    - [ ] Admin email needs to replace testd3v3@gmail.com
- [?] File upload system
    - [x] New users
    - [ ] Needs to work for admin/ checker/ annotator, etc
    - [ ] Needs to load to database, so its easier to access. Also, link to other patient attributes like age/gender/sex
- [?] User admin tool/ dash
    - [ ] Ability to enable to disable users. By default disabled even after they sign up
    - [ ] Ability to assign role to user (checker, annotator or reader)
- [ ] Segmentation automation
    - [ ] 