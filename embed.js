    let courses_url;
    try {
        courses_url = browser.runtime.getURL("courses.json")
    } catch (e) {
        courses_url = chrome.runtime.getURL("courses.json")
    }

    function getWindow(name, cur = window.top) {
        for (var i = 0; i < cur.length; i++) {
            if (cur[i].name == name) {
                return cur[i];
            }
            let nested = getWindow(name, cur[i])
            if (nested !== null) {
                return nested
            }
        }
        return null;
    }

    function selectionOnInput(e) {
        let latestSemester = $(getLatestSemesterSelect());
        var val = latestSemester.prev("input")[0].value
        var opts = latestSemester[0].childNodes;

        for (var i = 0; i < opts.length; i++) {
            if (opts[i].value === val) {
                let alertMessage = "\n";
                if ($(opts[i]).attr("missingPrerequisites") !== undefined) {
                    alertMessage += "Potentially missing prerequisite(s): " + $(opts[i]).attr("missingPrerequisites") + "\n"
                }
                if ($(opts[i]).attr("missingCorequisites") !== undefined) {
                    alertMessage += "Potentially missing corequisite(s): " + $(opts[i]).attr("missingCorequisites") + "\n"
                }
                if ($(opts[i]).attr("missingCoOrPrerequisites") !== undefined) {
                    alertMessage += "Potentially missing pre or corequisite(s): " + $(opts[i]).attr("missingCoOrPrerequisites") + "\n"
                }
                if (alertMessage !== "\n") {
                    alert("[" + opts[i].value + "]" + alertMessage)
                }
            }
        }
    }

    top.customRules = [];
    top.takenClasses = [];
    top.semesterNum = 0;
    let debug = false;

    //global var for modal to call outside
    top.modal = null;

    // Add an event listener to load the main function when jQuery is ready
    window.addEventListener("load", main);

    /**
     * Currently just fetches and prints degree information.
     */
    function main() {
        if (debug) console.log(`Main ran in ${window.name}`)
        // Whenever this is ran, an unload event (i.e. when the user loads a whatIf report)
        // triggers the collection of data needed to do a query for course information.
        // This isn't a listener because getting listeners to work inside iframes is hard.
        function setupWhatIfDataListener() {
            $(getWindow('frSelection')).on("unload", fetchWhatIfData)
        }

        // It's ran 10 times per second because again, listeners on iframes are hard.
        // This means the app would break if the user managed to get through the
        // DegreeWorks WhatIf form in a 10th of a second.
        setInterval(setupWhatIfDataListener, 100);
        console.log(window.name)
        if (window.name === "frBody") {
            addModal();
        }
        if (window.name === "frLeft") {
            let button = addButton(`DegweeWorks Planner`, getDegreeInfo, null, "genPossible")
            // addNumberField('Min courses/semester', 'minCourses', 4)
            // addNumberField('Max courses/semester', 'maxCourses', 4);
        }
    }

    let whatIfData = {};

    function fetchWhatIfData() {
        let form = $(getWindow('frSelection').frmWhatIfTop);
        if (form[0]) {
            // Clear the object's data
            for (const prop of Object.getOwnPropertyNames(whatIfData)) {
                delete whatIfData[prop];
            }

            // Populate it with new data
            $.each((form).serializeArray(), function () {
                whatIfData[this.name] = this.value;
            })
        }
    }

    /**
     * Fetches degree information
     * @returns XMLDocument
     */
    function getDegreeInfo() {
        console.log("running");
        var data = {};
        $.each($(getWindow('frControl').frmCallScript).serializeArray(), function () {
            data[this.name] = this.value;
        });
        $.each($(getWindow('frSelection').frmWhatIfPDF).serializeArray(), function () {
            data[this.name] = this.value;
        })

        // Best way I currently have of detecting if it's a whatIfReport
        let isWhatIfReport = !data["SCRIPT"].endsWith("&ContentType=xml");
        if (isWhatIfReport) {
            data = {
                ...data,
                ...whatIfData
            }
        }

        var settings = {
            "method": "POST",
            "timeout": 0,
            // "async": false,
            "cache": false,
            "data": data,
            "dataType": "xml"
        };

        let loader = $(".loader");
        let genButton = $("#genPossible");

        try {
            loader.fadeIn()
            genButton.prop("disabled", true)
            $(top.modal).find("#modalNext").prop("disabled", false)
            $(top.modal).find("#modalNextSemester").prop("disabled", false)
            $(top.modal).find("#semesters").find(".form-group")[0].innerHTML = getNewDataList()
            $(top.modal).find(".graduation-text").hide()
            $.ajax(settings).done(function (data) {
                showPossibleSemesters(visit(data));
                $(".loader").fadeOut()
                $("#genPossible").prop("disabled", false)
            });
        } catch (e) {
            // In the event of an error, avoid the loading state
            loader.fadeOut()
            genButton.prop("disabled", false)
        }
    }

    function visit(node) {
        if (node === null) {
            console.log("Warning: Tried to visit a null node. Try restarting DegreeWorks? Returning []");
            return [];
        }

        let nodeName;
        try {
            nodeName = node.documentElement.nodeName;
        } catch (e) {
            nodeName = node.nodeName;
        }

        switch (nodeName) {
            case "Report":
                return visitReport(node);
            case "Audit":
                return visitAudit(node);
            case "Block":
                return visitBlock(node);
            case "Rule":
                return visitRule(node);
            case "Requirement":
                return visitRequirement(node);
            case "Qualifier":
                return visitQualifier(node);
            case "Course":
                return visitCourse(node);
            case "ClassesApplied":
                return visitClassesApplied(node);
            case "IfPart":
                return visitIfPart(node);
            case "ElsePart":
                return visitElsePart(node);
            case "BooleanEvaluation":
                return visitBooleanEvaluation(node);
            case "Clsinfo":
                return visitClsinfo(node);
            case "In_progress":
                return visitInProgress(node);
            case "Class":
                return visitClass(node);
            default:
                throw `Unsupported node type?! ${nodeName} for ${node}`;
        }
    }

    function visitReport(report) {
        if (debug) console.log("Report", report);
        // Assumes a report contains exactly one audit
        return visit($(report).find("Audit")[0]);
    }

    function visitAudit(audit) {
        if (debug) console.log("Audit", audit);
        let incompleteRules = [];
        // Assumes audits contain blocks
        let blocks = $(audit).children("Block");
        $.each(blocks, function () {
            incompleteRules = [...incompleteRules, ...visit(this)];
        })
        // Avoid unnecessary nesting
        for (let resultKey in incompleteRules) {
            if (incompleteRules.hasOwnProperty(resultKey))
                while (incompleteRules[resultKey].length === 1) {
                    incompleteRules[resultKey] = incompleteRules[resultKey][0]
                }
        }

        let completeOrInProgressCourses = [];
        let clsinfos = $(audit).children("Clsinfo")
        $.each(clsinfos, function () {
            completeOrInProgressCourses = [...completeOrInProgressCourses, ...visit(this)];
        })
        let inprogresses = $(audit).children("In_progress")
        $.each(inprogresses, function () {
            completeOrInProgressCourses = [...completeOrInProgressCourses, ...visit(this)];
        })

        return [incompleteRules, completeOrInProgressCourses];
    }

    function visitBlock(block) {
        let results = [];
        let perComplete = block.getAttribute("Per_complete");
        // Rule is complete, therefore, we don't need to go any deeper.
        if (perComplete === "100") {
            return results;
        }
        if (debug) console.log("Block", block);
        // Assumes blocks contain rules
        let rules = $(block).children("Rule");
        $.each(rules, function () {
            results = [...results, ...visit(this)];
        })
        return results;
    }

    function visitRule(rule) {
        let results = [];
        let perComplete = rule.getAttribute("Per_complete");
        // Rule is complete, therefore, we don't need to go any deeper.
        if (perComplete === "100") {
            return results;
        }

        // https://www.fairmontstate.edu/it/sites/default/files/Degree%20Works%20Technical%20Guide%204.1.6.pdf
        let indentLevel = rule.getAttribute("IndentLevel");
        if (debug) console.log("->\t".repeat(indentLevel - 1) + "Rule", rule);
        let ruleType = rule.getAttribute("RuleType");

        switch (ruleType) {
            // At the course rule level, the calculation can take on some complex characteristics. Basically, the
            // calculation determines the number of classes or credits that are required for the rule and then
            // calculates the number of classes or credits applied to the rule. The percent complete is calculated
            // from those two factors. If a course is applied to a rule but has not yet been graded (i.e. it is "in
            // progress") and the rule would be completed with that course, the percent complete is reduced to
            // 98%. In the Degree Works reports we show these in-progress rules with a single squiggle
            // signifying that the rule is close to being completed. If the student ends up failing the class it will be
            // placed in Insufficient and the rule will end up with an empty box. There is no guarantee that the
            // in-progress class will actually end up on the rule once it has been completed since other classes
            // the student registers for may cause classes to be shifted around.
            // A rule qualifier that is not met will make the rule become 99% complete – given the required
            // credits/classes were taken. A MinSpread or MinPerDisc qualifier that has not been met will cause
            // the rule to be marked as 99% complete and will appear with a box with a double-squiggle on the
            // Degree Works worksheet.
            case "Course":
                let requirement = $(rule).children("Requirement")[0];
                if (requirement == null) {
                    console.warn("Rule requirement was null", rule);
                } else {
                    results = [visit(requirement)];
                }
                break;

            // The percent complete is calculated based on the total number of noncourses required and the
            // number of noncourses completed.
            case "Noncourse":
                // ...
                break;

            // All the rules within the subset form the basis of the percent complete calculation. If any subset
            // qualifiers are not satisfied (and all the rules are complete) the percent complete is reduced to
            // 99%. If all rules are complete but one or more contains an in-progress the subset will be
            // considered 98% also – the subset will inherit this property
            case "Subset":
                $.each($(rule).children("Rule"), function () {
                    let result = visit(this);
                    if (result.length > 0) {
                        results.push(result);
                    }
                })
                break;

            // The group(s) that is the "most complete" is used as the basis of the percent complete calculation.
            // For example, a group rule states that 1 group is needed from a list of four groups.
            // 1 GROUP in
            //  (8 CREDITS IN BIOL 100:199) or
            //  (8 CREDITS IN CHEM 100:199) or
            //  (8 CREDITS IN PHYS 100:199) or
            //  (9 CREDITS IN MATH 250 + CHEM 200 + CHEM 220)
            // If 6 credits have been applied to the last group and 4 credits to the first group, the last group will
            // be used to do the percent complete calculation.
            case "Group":
                // ...
                break;

            // XXX: I don't think this one matters to us. Unless it was part of an if statement or something,
            //  e.g. "You have to complete this block OR these two courses"
            // The percent complete is based on the details of the rule in the referenced block. If the referenced
            // block is not found in the audit, the percent complete is zero.
            case "Block":
                // ...
                break;
            case "Blocktype":
                // ...
                break;

            // If/Then/Else Rule
            // When the IF condition is FALSE and there is no ELSE rule, the IF statement is not included in the
            // block percent complete.
            // When the IF condition is true, the calculation is based on the rule type in the THEN portion of the
            // IF rule.
            case "IfStmt":
                results = visit($(rule).children("Requirement")[0])
                break;

            // Undocumented, but I've seen it as part of an IfPart
            case "Complete":
                break;

            // Undocumented also
            case "Incomplete":
                break;
            default:
                throw `Unsupported rule type?! ${ruleType} for ${rule}`;
        }

        // Avoid unnecessary flattening
        while (results.length === 1 && results[0].length !== undefined) {
            results = results[0]
        }
        return results;
    }

    function visitClsinfo(clsinfo) {
        if (debug) console.log("Clsinfo", clsinfo);
        let results = [];
        let courses = $(clsinfo).children("Class");
        $.each(courses, function () {
            results = [...results, ...visit(this)];
        })
        return results
    }

    function visitInProgress(inprogress) {
        if (debug) console.log("In_progress", inprogress);
        let results = [];
        let courses = $(inprogress).children("Class");
        $.each(courses, function () {
            results = [...results, ...visit(this)];
        })
        return results
    }

    function visitRequirement(requirement) {
        if (debug) console.log("Requirement", requirement);
        let results = [];

        // Some requirements are if statements. Their parent evaluates whether
        // the "if" is in effect, so we check for that then evaluate one of
        // the two paths and return the result. This assumes there will be
        // no course/qualifier for the same requirement.
        let leftCondition = $(requirement).children("LeftCondition")[0];
        if (leftCondition !== undefined) {
            let evaluation = visit($(requirement).parent().children("BooleanEvaluation")[0]);
            if (evaluation) {
                results = visit($(requirement).children("IfPart")[0]);
            } else {
                let elsePart = $(requirement).children("ElsePart")[0];
                if (elsePart !== undefined) {
                    results = visit(elsePart);
                } else {
                    results = [];
                }
            }
            return results;
        }

        // If it's not a conditional, assume there are qualifiers and courses
        let qualifiers = $(requirement).children("Qualifier");
        let courses = $(requirement).children("Course");
        $.each(qualifiers, function () {
            visit(this)
        })

        let classesRequired = requirement.getAttribute("Classes_begin");
        let classesApplied = $(requirement).parent()[0].getAttribute("Classes_applied");
        let ruleLabel = $(requirement).parent()[0].getAttribute("Label");
        let classesRemaining = classesRequired - classesApplied;

        $.each(courses, function () {
            // Makes sense to push if it's an OR?
            results = [...results, ...visit(this)];
        })

        if (results.length === 0 || classesRemaining === 0) {
            return [];
        }
        return {numClassesNeeded: classesRemaining, classOptions: results, ruleLabel: ruleLabel};
    }

    function visitQualifier(qualifier) {
        if (debug) console.log("Qualifier", qualifier);
    }

    function visitClassesApplied(classesApplied) {
        if (debug) console.log("ClassesApplied", classesApplied);
        let results = [];
        $.each($(classesApplied).children("Course"), function () {
            results.push(visit(this))
        })
        return results;
    }

    function visitCourse(course) {
        if (debug) console.log("Course", course);
        let hideFromAdvice = course.getAttribute("HideFromAdvice");
        if (hideFromAdvice === "Yes") {
            return [];
        }
        return [`${course.getAttribute("Disc")} ${course.getAttribute("Num")}`]
    }

    function visitClass(course) {
        if (course.getAttribute("Passed") === "Y")
            return [`${course.getAttribute("Discipline")} ${course.getAttribute("Number")}`]
        return []
    }

    function visitIfPart(ifPart) {
        if (debug) console.log("IfPart", ifPart);
        let results = [];
        $.each($(ifPart).children("Rule"), function () {
            results = [...results, ...visit(this)];
        })
        return results;
    }

    function visitElsePart(elsePart) {
        if (debug) console.log("ElsePart", elsePart);
        let results = [];
        $.each($(elsePart).children("Rule"), function () {
            results = [...results, ...visit(this)];
        })
        return results;
    }

    function visitBooleanEvaluation(booleanEvaluation) {
        return booleanEvaluation.innerHTML === "True";
    }

    /** Generating semesters **/
    function generateSemOptions(rules, previous_planned_semester, courses, takenClasses) {
        var prvOptions, prvOptionsIdx, prvOption, ruleIdx, rule, classOptions, classOptionsIdx, optionIdx, option;
        // max_classes = max_classes === void 0 ? parseInt($("#maxCourses")[0].value) : max_classes;
        // min_classes = min_classes === void 0 ? parseInt($("#minCourses")[0].value) : min_classes;
        let min_classes = 1;
        let max_classes = 1;
        previous_planned_semester = previous_planned_semester === void [] ? [] : previous_planned_semester;


        var _, options, prev_courses, classes_per_rule, new_classes_per_rule, course,
            new_courses, results, x, y;

        // Before we begin, update the rules with the previously planned semester
        for (ruleIdx = 0; ruleIdx < rules.length; ruleIdx++) {
            rule = rules[ruleIdx];
            classOptions = rule["classOptions"];
            for (classOptionsIdx = classOptions.length - 1; classOptionsIdx >= 0; classOptionsIdx--) {
                course = classOptions[classOptionsIdx];
                let plannedIdx = previous_planned_semester.indexOf(course);
                if (plannedIdx >= 0) {
                    if (rule["numClassesNeeded"] > 0) {
                        rule["numClassesNeeded"] -= 1;
                    }
                    classOptions.splice(classOptionsIdx, 1)
                }
            }
        }

        // Then, we start off with the null set: A semester with no enrollments
        options = [[[], new Array(rules.length).fill(0)]]
        let trulySeen = new Set();

        // Then, for each class we want to have...
        for (_ = 0; _ < max_classes; _++) {
            prvOptions = [...options]

            // We consider all ways to add one course to the previous sets
            for (prvOptionsIdx = 0; prvOptionsIdx < prvOptions.length; prvOptionsIdx++) {
                prvOption = prvOptions[prvOptionsIdx];
                prev_courses = prvOption[0];
                classes_per_rule = prvOption[1];

                // By considering each rule
                for (ruleIdx = 0; ruleIdx < rules.length; ruleIdx++) {
                    rule = rules[ruleIdx];
                    if (classes_per_rule[ruleIdx] >= rule["numClassesNeeded"]) {
                        continue
                    }
                    new_classes_per_rule = [...classes_per_rule];
                    ++new_classes_per_rule[ruleIdx];
                    classOptions = rule["classOptions"];

                    // ... and the courses that can be added from them
                    for (classOptionsIdx = 0; classOptionsIdx < classOptions.length; classOptionsIdx++) {
                        course = classOptions[classOptionsIdx];
                        let courseObj = courses[course];
                        if (!(prev_courses.indexOf(course) >= 0) || course.includes("@")) {
                            new_courses = [...prev_courses, course];
                            new_courses.sort();
                            let key = new_courses.join();
                            if (!trulySeen.has(key)) {
                                options.push([new_courses, new_classes_per_rule]);
                                trulySeen.add(key);
                            }
                        }
                    }
                }
            }
        }
        results = new Set();
        for (optionIdx = 0; optionIdx < options.length; optionIdx++) {
            option = options[optionIdx];
            x = option[0];
            y = option[1];
            if (x.length < min_classes) {
                continue
            }
            results.add(x)
        }
        results = [...results];
        results.sort()
        return results;
    }

    /** Code below here controls user interaction **/
    function addButton(text, onclick, cssObj, id) {
        cssObj = cssObj || {bottom: '7%', left: '4%', 'z-index': 3}
        let button = document.createElement('button'), btnStyle = button.style
        button.id = id
        button.setAttribute("data-toggle", "modal")
        button.setAttribute("data-target", "#exampleModal")
        button.setAttribute("class", "btn btn-outline-info")
        if (document.getElementById(id)) {
            return
        }
        document.body.appendChild(button)
        button.innerHTML = text
        button.onclick = onclick
        Object.keys(cssObj).forEach(key => btnStyle[key] = cssObj[key])
        $(button).after(`<div class='loader'></div>`)
        $(button).next().hide()
        return button
    }

    function addNumberField(labelText, id, value, cssObj) {
        if (document.getElementById(id)) {
            return
        }
        cssObj = cssObj || {bottom: '7%', left: '4%', 'z-index': 3}
        let labelField = document.createElement('label'), labelStyle = labelField.style
        let numberField = document.createElement('input'), fieldStyle = numberField.style
        numberField.type = "number"
        numberField.id = id
        numberField.value = value
        labelField.for = id
        labelField.innerText = labelText
        Object.keys(cssObj).forEach(key => labelStyle[key] = cssObj[key])
        Object.keys(cssObj).forEach(key => fieldStyle[key] = cssObj[key])
        document.body.appendChild(labelField)
        document.body.appendChild(numberField)
    }

    function getLatestSemesterSelect() {
        let semesters = $(top.modal).find("#semesters").find(".semester");
        return semesters[semesters.length - 1];
    }

    function uuidv4() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function getNewDataList(newSemester = false) {
        let dlid = uuidv4();
        return `${newSemester ? '<hr/>' : ''}<input class="form-control${newSemester ? ' newSem' : ''}" list="${dlid}" semNum="${top.semesterNum}" placeholder="Type to search...">
                <datalist id="${dlid}" class="semester" required semNum="${top.semesterNum}"></datalist>`
    }

    function addResults(optionTexts, id, courses, semesters, takenClasses, newSemester = false) {
        if (optionTexts.length === 0) {
            $(top.modal).find("#modalNext").prop("disabled", "true")
            $(top.modal).find("#modalNextSemester").prop("disabled", "true")
            $(top.modal).find(".graduation-text").show()
            return
        }

        let prevSemesterCourses = [];
        let curSemesterCourses = [];
        let allSemesters = $(top.modal).find("#semesters").find(".semester");
        allSemesters.each(function (i) {
            let sem = allSemesters[i];
            semCourses = $(sem).prev("input").val().split(",");
            if ($(sem).attr("semNum") == top.semesterNum) {
                curSemesterCourses = [...curSemesterCourses, ...semCourses];
            } else {
                prevSemesterCourses = [...prevSemesterCourses, ...semCourses];
            }
        })

        let semesterSelect = getLatestSemesterSelect();

        // If there's already a semester here, add a new one
        if (semesterSelect.innerHTML.trim() !== "") {
            $(semesterSelect).prop("disabled", true)
            $(semesterSelect).prev("input").prop("disabled", true)
            $(semesterSelect).after(getNewDataList(newSemester))
            semesterSelect = $(semesterSelect).next().next()[0]
            if (newSemester)
                semesterSelect = $(semesterSelect).next()[0]
        }

        for (let i = 0; i < optionTexts.length; i++) {
            var option = document.createElement("option");


            let subtitledOptionTexts = [];
            let missingPrerequisites = [];
            let missingCorequisites = [];
            let missingCoOrPrerequisites = [];
            for (let j = 0; j < optionTexts[i].length; j++) {
                let course = optionTexts[i][j];
                let courseObj = courses[course];
                if (courseObj !== undefined) {
                    let prereqs = courseObj["Prerequisite(s)"]
                    if (prereqs !== undefined) {
                        for (let k = 0; k < prereqs.length; k++) {
                            let prereq = prereqs[k];
                            if (takenClasses.indexOf(prereq) === -1
                                && prevSemesterCourses.indexOf(prereq) === -1
                                && missingPrerequisites.indexOf(prereq) === -1) {
                                missingPrerequisites.push(prereq)
                            }
                        }
                    }
                    let coreqs = courseObj["Corequisites(s)"]
                    if (coreqs !== undefined) {
                        for (let k = 0; k < coreqs.length; k++) {
                            let coreq = coreqs[k];
                            if (curSemesterCourses.indexOf(coreq) === -1
                                && missingCorequisites.indexOf(coreq) === -1) {
                                missingCorequisites.push(coreq)
                            }
                        }
                    }
                    let coOrPreReqs = courseObj["Pre- or Corequisite(s)"]
                    if (coOrPreReqs !== undefined) {
                        for (let k = 0; k < coOrPreReqs.length; k++) {
                            let coOrPreReq = coOrPreReqs[k];
                            if (takenClasses.indexOf(coOrPreReq) === -1
                                && prevSemesterCourses.indexOf(coOrPreReq) === -1
                                && curSemesterCourses.indexOf(coOrPreReq) === -1
                                && missingCoOrPrerequisites.indexOf(coOrPreReq) === -1) {
                                missingCoOrPrerequisites.push(coOrPreReq)
                            }
                        }
                    }
                    course = courseObj['Credit Hours'].substring(1, courseObj['Credit Hours'].length - 1) + " Credit Hour(s) | " + courseObj['name']
                }
                subtitledOptionTexts.push(course)
            }


            option.innerText = subtitledOptionTexts.join();
            if (missingPrerequisites.length > 0) {
                option.innerText = "*" + option.innerText;
                option.setAttribute("missingPrerequisites", missingPrerequisites.join())
            }
            if (missingCorequisites.length > 0) {
                if (!option.innerText[0] === "*")
                    option.innerText = "*" + option.innerText;
                option.setAttribute("missingCorequisites", missingCorequisites.join())
            }
            if (missingCoOrPrerequisites.length > 0) {
                if (!option.innerText[0] === "*")
                    option.innerText = "*" + option.innerText;
                option.setAttribute("missingCoOrPrerequisites", missingCoOrPrerequisites.join())
            }
            option.value = optionTexts[i].join();
            semesterSelect.appendChild(option);
        }
        //parent.frames['frBody'].document.getElementById("modal-body").appendChild(select);

        let $options = $(semesterSelect).children()
        var sortList = Array.prototype.sort.bind($options)
        sortList(function (a, b) {
            var aText = a.innerText;
            var bText = b.innerText;

            if (aText[0] === "*" && bText[0] !== "*")
                return 1;

            if (aText[0] !== "*" && bText[0] === "*")
                return -1;

            if (aText < bText) {
                return -1;
            }
            if (aText > bText) {
                return 1;
            }
            return 0;
        });
        $(semesterSelect).append($options)


        $(semesterSelect).prev("input").change(selectionOnInput)

        return semesterSelect
    }

    function addModal() {
        if (document.getElementById('exampleModal')) {
            return
        }
        var html = `
            <!-- The Modal -->
            <div class="modal fade" id="exampleModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
            <div class="modal-dialog" role="document">
              <!-- Modal content -->
              <div class="modal-content"  style="background:#99EDC3">
              <div class="modal-header">
              <h2 class="modal-title">DegweeWorks Planner</h2>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
                <form id="courseForm">
                    <div id="modal-body" class="modal-body">
                        <div id="semesters">
                            <div class="form-group">
                                $(getNewDataList)
                                </select>
                            </div>
                           <div class="graduation-text alert alert-success" role="alert" style="display: none">
                                    Degwee complete! 🎓
                           </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" id="modalPrint" class="btn btn-dark" style="display:inline" onclick="window.print()">Print</button>
                        <button type="button" id="modalReset" class="btn btn-info" style="display:inline">Reset</button>
                        <button type="button" id="modalNextSemester" class="btn btn-secondary" style="display:inline">Next Semester</button>
                        <button type="submit" id="modalNext" class="btn btn-primary" style="display:inline">Add New</button>
                    </div>
                </form>
              </div>
              </div>
            </div>
            </div>
            `;
        let div = document.createElement('div');
        document.body.appendChild(div);
        div.innerHTML = html;

        // Get the modal
        top.modal = document.getElementById('exampleModal');
        top.modalController = new bootstrap.Modal(top.modal, {
            // Prevent accidental closings (especially prevalent when dragging mouse)
            // keyboard: false,
            backdrop: 'static'
        })

        $("#modalReset").click(function (e) {
            top.semesterNum = 0;
            top.customRules = JSON.parse(JSON.stringify(top.resetRules))
            $(top.modal).find("#modalNext").prop("disabled", false)
            $(top.modal).find("#modalNextSemester").prop("disabled", false)
            $(top.modal).find("#semesters").find(".form-group")[0].innerHTML = getNewDataList()
            $(top.modal).find(".graduation-text").hide()

            addResultsForRules(top.customRules, [], top.takenClasses)
        })
        $("#modalNextSemester").click(function (e) {
            top.semesterNum++;
            showPossibleSemesters(null, true)
        })

        $("#courseForm").submit(function (e) {
            e.preventDefault();
            showPossibleSemesters();
        });
    }

    function addResultsForRules(customRules, semesters, takenClasses, newSemester = false) {
        $.getJSON(courses_url).then(function (data) {
            return data
        }).then(function (courses) {
            let semData = generateSemOptions(customRules, semesters, courses, takenClasses);
            try {
                addResults(semData, "semResult", courses, semesters, takenClasses, newSemester)
            } catch (e) {
                console.log(e)
            }
        })
    }

    function showPossibleSemesters(customRulesAndTakenClasses, newSemester = false) {
        if (customRulesAndTakenClasses) {
            top.customRules = customRulesAndTakenClasses[0];
            top.takenClasses = customRulesAndTakenClasses[1];
            top.resetRules = JSON.parse(JSON.stringify(top.customRules))
        }
        if (debug) console.log(top.customRules)
        let semesters = []
        let semesterSelectValue = $(getLatestSemesterSelect()).prev("input").val()
        if (debug) console.log(semesterSelectValue)
        if (semesterSelectValue) {
            semesters = semesterSelectValue.split(",");
        }

        addResultsForRules(top.customRules, semesters, top.takenClasses, newSemester);
        top.modalController.show()
    }
