$(function () {
    let debug = true;

    //global var for modal to call outside
    var modal = null;

    /**
     * Instructions for usage:
     * 1. Install the extension
     * 2. Go to https://degreeworks.uncc.edu/DashboardServlet/
     * 3. Set minimum and maximum courses as desired
     * 4. Click "Generate possible semesters"
     * 5. View possible semesters by clicking the dropdown and scrolling
     */
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
            $(top.frBodyContainer.frSelection).on("unload", fetchWhatIfData)
        }

        // It's ran 10 times per second because again, listeners on iframes are hard.
        // This means the app would break if the user managed to get through the
        // DegreeWorks WhatIf form in a 10th of a second.
        setInterval(setupWhatIfDataListener, 100);
        if(window.name == "frBody") {
            addModal();
        }
        if (window.name === "frLeft") {
            addButton(`Generate possible semesters`, getDegreeInfo, null, "genPossible")
            addNumberField('Min courses/semester', 'minCourses', 4)
            addNumberField('Max courses/semester', 'maxCourses', 4);
        }
    }

    let whatIfData = {};

    function fetchWhatIfData() {
        let form = $(top.frBodyContainer.frSelection.frmWhatIfTop);
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
        var data = {};
        $.each($(top.frControl.frmCallScript).serializeArray(), function () {
            data[this.name] = this.value;
        });
        $.each($(top.frBodyContainer.frSelection.frmWhatIfPDF).serializeArray(), function () {
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

        $.ajax(settings).done(function (data) {
            showPossibleSemesters(visit(data))
        });
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
        let results = [];
        // Assumes audits contain blocks
        let blocks = $(audit).children("Block");
        $.each(blocks, function () {
            results = [...results, ...visit(this)];
        })
        // Avoid unnecessary flattening
        for (let resultKey in results) {
            if (results.hasOwnProperty(resultKey))
                while (results[resultKey].length === 1) {
                    results[resultKey] = results[resultKey][0]
                }
        }
        return results;
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
        return { numClassesNeeded: classesRemaining, classOptions: results, ruleLabel: ruleLabel };
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
        return [`${course.getAttribute("Disc")}-${course.getAttribute("Num")}`]
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
    function generateSemOptions(rules, max_classes, min_classes, previous_planned_semester) {
        var prvOptions, prvOptionsIdx, prvOption, ruleIdx, rule, classOptions, classOptionsIdx, optionIdx, option;
        max_classes = max_classes === void 0 ? parseInt($("#maxCourses")[0].value) : max_classes;
        min_classes = min_classes === void 0 ? parseInt($("#minCourses")[0].value) : min_classes;
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
        cssObj = cssObj || { bottom: '7%', left: '4%', 'z-index': 3 }
        let button = document.createElement('button'), btnStyle = button.style
        button.id = id
        if (document.getElementById(id)) {
            return
        }
        document.body.appendChild(button)
        button.innerHTML = text
        button.onclick = onclick
        Object.keys(cssObj).forEach(key => btnStyle[key] = cssObj[key])
        return button
    }

    function addNumberField(labelText, id, value, cssObj) {
        if (document.getElementById(id)) {
            return
        }
        cssObj = cssObj || { bottom: '7%', left: '4%', 'z-index': 3 }
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

    function addResults(optionTexts, id) {
        $("#" + id).remove()
        let select = document.createElement('select');
        select.id = id;
        for (let i = 0; i < optionTexts.length; i++) {
            var option = document.createElement("option");
            option.text = optionTexts[i].join();
            select.add(option);
        }
        document.body.appendChild(select)

        return select
    }

    function addModal() {
        if (document.getElementById('myModal')) {
            return
        }
        var html = `
        <style>
        /* The Modal (background) */
            .modalWrap {
                display: none; /* Hidden by default */
                position: fixed; /* Stay in place */
                z-index: 1; /* Sit on top */
                left: 0;
                top: 0;
                width: 100%; /* Full width */
                height: 100%; /* Full height */
                overflow: auto; /* Enable scroll if needed */
                background-color: rgb(0,0,0); /* Fallback color */
                background-color: rgba(0,0,0,0.4); /* Black w/ opacity */
            }
            /* Modal Content/Box */
            .modal-content {
            background-color: #fefefe;
            margin: 15% auto; /* 15% from the top and centered */
            padding: 20px;
            border: 1px solid #888;
            width: 80%; /* Could be more or less, depending on screen size */
            }

            /* The Close Button */
            .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            }

            .close:hover,
            .close:focus {
            color: black;
            text-decoration: none;
            cursor: pointer;
            }
        </style>
            <!-- The Modal -->
            <div id="myModal" class="modalWrap">
            <div class="modal">
              <!-- Modal content -->
              <div class="modal-content">
                <span class="close">&times;</span>
                <h2>Results<h2>
                <button class="btn btn-secondary dropdown-toggle" type="button" id="dropdownMenuButton" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                Dropdown button
                </button>
                <div class="dropdown-menu" aria-labelledby="dropdownMenuButton">
                    <a class="dropdown-item" href="#">Action</a>
                    <a class="dropdown-item" href="#">Another action</a>
                    <a class="dropdown-item" href="#">Something else here</a>
                </div>
                <p>min classes: 3 && max classes: 4</p>
                <button type="button">Next</button>
              </div>
              </div>
            </div>
            `;
        let div = document.createElement('div');
        document.body.appendChild(div);
        div.innerHTML = html;

        // Get the modal
        modal = document.getElementById("myModal");

        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        }
    }

    function showPossibleSemesters(possibleSemesterData) {
        /** Unfinished, currently just alerts **/
        let semData = generateSemOptions(possibleSemesterData);
        if (window.name === "frLeft") {
            addResults(semData, "semResult")
        }
        modal = parent.frames['frBody'].document.getElementById("myModal");
        var span =  parent.frames['frBody'].document.getElementsByClassName("close")[0];
        // When the user clicks on <span> (x), close the modal
        span.onclick = function () {
            modal.style.display = "none";
            }
        modal.style.display = "block";
    }
})