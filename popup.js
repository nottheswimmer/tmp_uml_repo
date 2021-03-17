document.addEventListener('DOMContentLoaded', function () {
    var clickButton = document.getElementById('clickThis');
    clickButton.addEventListener('click', function () {
        // Load a modern version of jQuery for form serialization / Ajax
        var jq = document.createElement("script");
        jq.src = "//code.jquery.com/jquery-3.5.1.min.js";
        document.getElementsByTagName('head')[0].appendChild(jq);
        try {
            jQuery.noConflict();
        } catch {
        }

        // Add an event listener to load the main function when jQuery is ready
        jq.addEventListener("load", main);

        /**
         * Currently just fetches and prints degree information.
         */
        function main() {
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

            // Get the degree info and traverse it
            return visit(getDegreeInfo());
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
                "async": false,
                "cache": false,
                "data": data,
                "dataType": "xml"
            };

            let response = null;
            $.ajax(settings).done(function (data) {
                response = data;
            });

            return response;
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
            console.log("Report", report);
            // Assumes a report contains exactly one audit
            return visit($(report).find("Audit")[0]);
        }

        function visitAudit(audit) {
            console.log("Audit", audit);
            let results = [];
            // Assumes audits contain blocks
            let blocks = $(audit).children("Block");
            $.each(blocks, function () {
                results = [...results, ...visit(this)];
            })
            // Avoid unnecessary flattening
            for (let resultKey in results) {
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
            console.log("Block", block);
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
            console.log("->\t".repeat(indentLevel - 1) + "Rule", rule);
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
            console.log("Requirement", requirement);
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
                    results = visit($(requirement).children("ElsePart")[0]);
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
            console.log("Qualifier", qualifier);
        }

        function visitClassesApplied(classesApplied) {
            console.log("ClassesApplied", classesApplied);
            let results = [];
            $.each($(classesApplied).children("Course"), function () {
                results.push(visit(this))
            })
            return results;
        }

        function visitCourse(course) {
            console.log("Course", course);
            return [`${course.getAttribute("Disc")}-${course.getAttribute("Num")}`]
        }

        function visitIfPart(ifPart) {
            console.log("IfPart", ifPart);
            let results = [];
            $.each($(ifPart).children("Rule"), function () {
                results = [...results, ...visit(this)];
            })
            return results;
        }

        function visitElsePart(elsePart) {
            console.log("ElsePart", elsePart);
            let results = [];
            $.each($(elsePart).children("Rule"), function () {
                results = [...results, ...visit(this)];
            })
            return results;
        }

        function visitBooleanEvaluation(booleanEvaluation) {
            return booleanEvaluation.innerHTML === "True";
        }

        /** This is how you can access the raw XML (if we want to parse it externally) **/
        function getDegreeInfoRawXML() {
            return new XMLSerializer().serializeToString(getDegreeInfo())
        }
    }, false);
}, false);