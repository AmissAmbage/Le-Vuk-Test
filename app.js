(function () {
  const CARB_SOURCES = {
    rice: { label: "Rice (cooked)", gramsPer100: 27.6 },
    oats: { label: "Oats (dry)", gramsPer100: 66 },
    potato: { label: "Potato (boiled)", gramsPer100: 17 }
  };

  const FAT_SOURCES = {
    butter: { label: "Butter", gramsPerTbsp: 11.5 },
    oliveOil: { label: "Olive Oil", gramsPerTbsp: 13.5 },
    peanutButter: { label: "Peanut Butter", gramsPerTbsp: 8 }
  };

  const EXPERIENCE_COPY = {
    novice: "Auto classification: Novice lifter — prioritize technique, big lifts, and ample recovery.",
    intermediate: "Auto classification: Intermediate lifter — blend primary lifts with accessory volume 4–5x per week.",
    advanced: "Auto classification: Advanced lifter — rotate intensities, use deloads, and track fatigue closely."
  };

  const MUSCLE_CEILINGS = {
    novice: 0.25,
    intermediate: 0.12,
    advanced: 0.05
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function round(value, decimals = 0) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  function normalizedSeries(total, weeks) {
    if (weeks <= 0) {
      return [];
    }
    const base = 0.82;
    const weights = Array.from({ length: weeks }, (_, i) => Math.pow(base, i));
    const sum = weights.reduce((acc, val) => acc + val, 0);
    if (sum === 0) {
      return Array.from({ length: weeks }, () => 0);
    }
    return weights.map((weight) => (total * weight) / sum);
  }

  function determineAutoGoal(bodyfat) {
    if (bodyfat >= 20) {
      return { goal: "cut", message: "Auto: Body fat is elevated — prioritizing a cut improves health and training quality." };
    }
    if (bodyfat <= 12) {
      return { goal: "bulk", message: "Auto: You’re lean enough to support a productive muscle-gain phase." };
    }
    return { goal: "bulk", message: "Auto: Sitting in the middle ground — a lean gain phase keeps momentum." };
  }

  function buildSuggestions(ctx) {
    const { goal, fatChangeKg, muscleChangeKg, exp, aggr, bodyfat, weeks, requestedFatChange, requestedMuscleChange } = ctx;
    const notes = [];
    const out = {};
    const baseFatCap = 0.8 * weeks;
    const baseMuscleCap = MUSCLE_CEILINGS[exp] * weeks;

    if (goal === "cut" && Math.abs(requestedFatChange) > baseFatCap + 1e-6) {
      out.aggr = aggr > 1 ? 1 : 0.75;
      notes.push("Fat-loss pace too high; reduce intensity.");
    }

    if (goal === "bulk" && requestedMuscleChange > baseMuscleCap + 1e-6) {
      out.aggr = aggr > 1 ? 1 : 0.75;
      notes.push("Muscle gain pace too high; reduce intensity.");
    }

    if (goal === "bulk" && bodyfat >= 18) {
      out.goalMode = "cut";
      notes.push("High BF while bulking — cut first for better outcomes.");
    }

    if (!notes.length) {
      return null;
    }

    return { ...out, notes };
  }

  function trainingRecommendation(goal, exp, aggr) {
    const intensityText = aggr > 1
      ? "Dial back 1–2 hard sets per muscle when fatigue builds."
      : "Keep volume steady and focus on progressive overload.";
    const cutRecommendations = {
      novice: "3 full-body sessions with 2 easy conditioning days.",
      intermediate: "4 strength sessions emphasizing compound lifts and 1–2 cardio days.",
      advanced: "4 heavy sessions plus 1 lower-intensity pump day; monitor joints closely."
    };

    const bulkRecommendations = {
      novice: "3–4 full-body or upper/lower sessions to maximize practice of the big lifts.",
      intermediate: "4–5 sessions with a push/pull/legs bias and dedicated accessory work.",
      advanced: "5–6 focused sessions balancing overload with strategic deloads."
    };

    const recoveryCut = "Prioritize 7–9 hours of sleep, electrolytes, and walking for circulation.";
    const recoveryBulk = "Anchor meals around training, stay within 10% of TDEE, and keep steps above 7k.";
    const recoveryExtreme = aggr >= 1.25 ? "Layer in parasympathetic work (breathing drills, light mobility) to offset stress." : "Track HRV or resting heart rate weekly to catch fatigue early.";

    if (goal === "cut") {
      return {
        training: `${cutRecommendations[exp]} ${intensityText}`.trim(),
        recovery: `${recoveryCut} ${recoveryExtreme}`.trim()
      };
    }

    return {
      training: `${bulkRecommendations[exp]} ${intensityText}`.trim(),
      recovery: `${recoveryBulk} ${recoveryExtreme}`.trim()
    };
  }

  function generateProgressSeries({ weight, bodyfat, weeks, goal, fatChangeKg, muscleChangeKg }) {
    const labels = Array.from({ length: weeks + 1 }, (_, idx) => `Week ${idx}`);
    const initialBodyfat = bodyfat / 100;
    const fatMass0 = weight * initialBodyfat;
    const leanMass0 = weight - fatMass0;
    const fatPerWeek = weeks > 0 ? fatChangeKg / weeks : 0;
    const muscleIncrements = normalizedSeries(muscleChangeKg, weeks);

    const weights = [];
    const bfs = [];
    const muscles = [];
    let cumulativeMuscle = 0;

    for (let i = 0; i <= weeks; i += 1) {
      const fatDelta = fatPerWeek * i;
      if (i > 0 && muscleIncrements.length) {
        cumulativeMuscle += muscleIncrements[i - 1];
      }
      const leanMass = leanMass0 + cumulativeMuscle;
      const fatMass = fatMass0 + fatDelta;
      const totalWeight = leanMass + fatMass;
      weights.push(round(totalWeight, 2));
      const bfPercent = totalWeight > 0 ? (fatMass / totalWeight) * 100 : 0;
      bfs.push(round(bfPercent, 2));
      muscles.push(round(cumulativeMuscle, 2));
    }

    return { labels, weights, bfs, muscles };
  }

  function computePlan(input) {
    const weight = clamp(Number(input.weight), 30, 250);
    const bodyfat = clamp(Number(input.bodyfat), 3, 60);
    const tdee = clamp(Number(input.tdee), 1000, 6000);
    const weeks = clamp(Number(input.weeks), 1, 104);
    const meals = clamp(Number(input.meals), 1, 6);
    const goalMode = input.goalMode;
    const aggr = Number(input.aggr);
    const exp = input.exp;
    const carbSource = input.carbSource;
    const fatSource = input.fatSource;

    const autoGoal = goalMode === "auto" ? determineAutoGoal(bodyfat) : null;
    const goal = autoGoal ? autoGoal.goal : goalMode;
    const autoMsg = autoGoal ? autoGoal.message : "Manual goal selection.";

    const protein = weight * 2;
    const fats = weight * 0.9;
    const proteinKcal = protein * 4;
    const fatKcal = fats * 9;

    let fatChangeKg = 0;
    let muscleChangeKg = 0;
    const muscleCeiling = MUSCLE_CEILINGS[exp];
    const requestedFatChange = goal === "cut" ? -0.8 * weeks * aggr : 0;
    const requestedMuscleChange = goal === "bulk" ? muscleCeiling * weeks * aggr : 0;

    if (goal === "cut") {
      fatChangeKg = requestedFatChange;
      muscleChangeKg = 0;
    } else {
      fatChangeKg = 0;
      muscleChangeKg = requestedMuscleChange;
    }

    const initialBodyfat = bodyfat / 100;
    const fatMass0 = weight * initialBodyfat;
    const leanMass0 = weight - fatMass0;

    const minFatChange = (0.03 * weight - fatMass0) / 0.97;
    if (goal === "cut") {
      fatChangeKg = Math.max(fatChangeKg, minFatChange);
    }

    const maxMuscleChange = muscleCeiling * weeks * 1.1;
    if (goal === "bulk") {
      muscleChangeKg = Math.min(muscleChangeKg, maxMuscleChange);
    }

    const dailyDelta = (fatChangeKg * 7700 + muscleChangeKg * 2500) / (weeks * 7);
    const targetCalories = tdee + dailyDelta;

    const remainingCalories = targetCalories - proteinKcal - fatKcal;
    const carbs = Math.max(0, remainingCalories / 4);

    const calPerMeal = targetCalories / meals;
    const PperMeal = protein / meals;
    const CperMeal = carbs / meals;
    const FperMeal = fats / meals;

    const gramsChicken = (PperMeal / 29.5) * 100;
    const carbInfo = CARB_SOURCES[carbSource];
    const fatInfo = FAT_SOURCES[fatSource];
    const gramsCarb = carbInfo ? (CperMeal / carbInfo.gramsPer100) * 100 : 0;
    const tbspFat = fatInfo ? FperMeal / fatInfo.gramsPerTbsp : 0;

    const projection = generateProgressSeries({
      weight,
      bodyfat,
      weeks,
      goal,
      fatChangeKg,
      muscleChangeKg
    });

    const finalWeight = projection.weights[projection.weights.length - 1];
    const finalBF = projection.bfs[projection.bfs.length - 1];

    const recs = trainingRecommendation(goal, exp, aggr);

    const suggestions = buildSuggestions({
      goal,
      fatChangeKg,
      muscleChangeKg,
      exp,
      aggr,
      bodyfat,
      weeks,
      requestedFatChange,
      requestedMuscleChange
    });

    return {
      targetCalories,
      protein,
      carbs,
      fats,
      calPerMeal,
      PperMeal,
      CperMeal,
      FperMeal,
      gramsChicken,
      gramsCarb,
      tbspFat,
      goal,
      autoMsg,
      fatChangeKg,
      muscleChangeKg,
      finalWeight,
      finalBF,
      trainingRec: recs.training,
      recoveryTips: recs.recovery,
      labels: projection.labels,
      weights: projection.weights,
      bfs: projection.bfs,
      muscles: projection.muscles,
      suggestions
    };
  }

  function formatNumber(value, decimals = 0) {
    return Number.isFinite(value)
      ? round(value, decimals).toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        })
      : "—";
  }

  function formatPortion(value, decimals = 0) {
    const formatted = round(value, decimals);
    return formatted < 0.05 ? "<0.1" : formatted.toFixed(decimals);
  }

  function destroyChart() {
    if (window.progressChart && typeof window.progressChart.destroy === "function") {
      window.progressChart.destroy();
    }
    window.progressChart = null;
  }

  function renderProjectionChart({ labels, weights, bfs, muscles }) {
    const canvas = document.getElementById("progress-chart");
    if (!canvas) {
      return;
    }
    if (typeof Chart === "undefined") {
      console.warn("Chart.js is not available; skipping chart render.");
      return;
    }
    const ctx = canvas.getContext("2d");
    destroyChart();
    window.progressChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Weight (kg)",
            data: weights,
            borderColor: "#2f5d9f",
            backgroundColor: "rgba(47, 93, 159, 0.15)",
            tension: 0.3,
            yAxisID: "y"
          },
          {
            label: "Body Fat %",
            data: bfs,
            borderColor: "#f97316",
            backgroundColor: "rgba(249, 115, 22, 0.15)",
            tension: 0.3,
            yAxisID: "y1"
          },
          {
            label: "Muscle Gain (kg)",
            data: muscles,
            borderColor: "#16a34a",
            backgroundColor: "rgba(22, 163, 74, 0.1)",
            tension: 0.3,
            yAxisID: "y2"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            type: "linear",
            position: "left",
            title: { display: true, text: "Weight (kg)" }
          },
          y1: {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "Body Fat %" }
          },
          y2: {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "Muscle Gain (kg)" },
            ticks: { callback: (value) => `${value}` }
          }
        },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: { enabled: true }
        }
      }
    });
  }

  function sanitizeFormValues(values) {
    return {
      weight: clamp(values.weight, 30, 250),
      bodyfat: clamp(values.bodyfat, 3, 60),
      tdee: clamp(values.tdee, 1000, 6000),
      weeks: clamp(values.weeks, 1, 104),
      meals: clamp(values.meals, 1, 6),
      goalMode: values.goalMode,
      aggr: values.aggr,
      exp: values.exp,
      carbSource: values.carbSource,
      fatSource: values.fatSource
    };
  }

  function collectFormValues(form) {
    return {
      weight: Number(form.weight.value),
      bodyfat: Number(form.bodyfat.value),
      tdee: Number(form.tdee.value),
      weeks: Number(form.weeks.value),
      meals: Number(form.meals.value),
      goalMode: form.goal.value,
      aggr: form.intensity.value,
      exp: form.experience.value,
      carbSource: form["carb-source"].value,
      fatSource: form["fat-source"].value
    };
  }

  function updateFormWithSanitized(form, sanitized) {
    form.weight.value = sanitized.weight;
    form.bodyfat.value = sanitized.bodyfat;
    form.tdee.value = sanitized.tdee;
    form.weeks.value = sanitized.weeks;
    form.meals.value = sanitized.meals;
  }

  function updateMealsLabel(meals) {
    const mealsCount = document.getElementById("meals-count");
    if (mealsCount) {
      mealsCount.textContent = `${meals} ${meals === 1 ? "meal" : "meals"}`;
    }
  }

  function updateAutoClass(exp) {
    const el = document.getElementById("auto-class");
    if (el) {
      el.textContent = EXPERIENCE_COPY[exp] || "Select your closest match — we’ll tailor recommendations based on it.";
    }
  }

  let latestSuggestions = null;
  let lastPlan = null;

  function handleCalculate(applied = false) {
    const form = document.getElementById("inputs-form");
    const rawValues = collectFormValues(form);
    const sanitized = sanitizeFormValues(rawValues);
    updateFormWithSanitized(form, sanitized);
    updateMealsLabel(sanitized.meals);
    updateAutoClass(sanitized.exp);
    const plan = computePlan({ ...sanitized, aggr: Number(sanitized.aggr) });
    lastPlan = plan;

    document.getElementById("target-calories").textContent = formatNumber(plan.targetCalories, 0);
    document.getElementById("daily-protein").textContent = formatNumber(plan.protein, 0);
    document.getElementById("daily-carbs").textContent = formatNumber(plan.carbs, 0);
    document.getElementById("daily-fats").textContent = formatNumber(plan.fats, 0);

    document.getElementById("meal-calories").textContent = formatNumber(plan.calPerMeal, 0);
    document.getElementById("meal-protein").textContent = formatNumber(plan.PperMeal, 1);
    document.getElementById("meal-carbs").textContent = formatNumber(plan.CperMeal, 1);
    document.getElementById("meal-fats").textContent = formatNumber(plan.FperMeal, 1);

    const carbLabel = CARB_SOURCES[sanitized.carbSource]?.label ?? "Carb";
    const fatLabel = FAT_SOURCES[sanitized.fatSource]?.label ?? "Fat";
    document.getElementById("portion-carb-label").textContent = carbLabel;
    document.getElementById("portion-fat-label").textContent = fatLabel;
    document.getElementById("portion-chicken").textContent = formatNumber(plan.gramsChicken, 0);
    document.getElementById("portion-carb").textContent = formatNumber(plan.gramsCarb, 0);
    document.getElementById("portion-fat").textContent = formatPortion(plan.tbspFat, 1);

    const goalText = plan.goal === sanitized.goalMode || sanitized.goalMode === "auto"
      ? `${plan.goal.toUpperCase()}${sanitized.goalMode === "auto" ? " (auto)" : ""}`
      : `${plan.goal.toUpperCase()} (adjusted)`;
    document.getElementById("goal-text").textContent = goalText;
    document.getElementById("auto-message").textContent = plan.autoMsg;
    document.getElementById("fat-change").textContent = formatNumber(plan.fatChangeKg, 1);
    document.getElementById("muscle-change").textContent = formatNumber(plan.muscleChangeKg, 1);
    document.getElementById("final-weight").textContent = formatNumber(plan.finalWeight, 1);
    document.getElementById("final-bf").textContent = formatNumber(plan.finalBF, 1);
    document.getElementById("training-rec").textContent = plan.trainingRec;
    document.getElementById("recovery-tips").textContent = plan.recoveryTips;

    renderProjectionChart({ labels: plan.labels, weights: plan.weights, bfs: plan.bfs, muscles: plan.muscles });

    const suggestionsEl = document.getElementById("suggestions");
    const suggestionsList = document.getElementById("suggestions-list");
    const applyBtn = document.getElementById("apply-btn");
    const appliedBanner = document.getElementById("applied-banner");

    latestSuggestions = plan.suggestions;
    suggestionsList.innerHTML = "";
    if (plan.suggestions) {
      suggestionsEl.hidden = false;
      applyBtn.hidden = false;
      plan.suggestions.notes.forEach((note) => {
        const li = document.createElement("li");
        li.textContent = note;
        suggestionsList.appendChild(li);
      });
    } else {
      suggestionsEl.hidden = true;
      applyBtn.hidden = true;
    }

    if (!applied) {
      appliedBanner.hidden = true;
    }

    return plan;
  }

  function applySuggestions() {
    if (!latestSuggestions) {
      return;
    }
    const form = document.getElementById("inputs-form");
    if (latestSuggestions.goalMode) {
      form.goal.value = latestSuggestions.goalMode;
    }
    if (latestSuggestions.aggr) {
      form.intensity.value = String(latestSuggestions.aggr);
    }
    const appliedBanner = document.getElementById("applied-banner");
    appliedBanner.hidden = false;
    handleCalculate(true);
  }

  function runTests() {
    const output = document.getElementById("tests-output");
    output.innerHTML = "";

    const tests = [
      {
        name: "Cut baseline (intermediate, 6 wks)",
        run: () => {
          const plan = computePlan({
            weight: 71,
            bodyfat: 20,
            tdee: 2568,
            weeks: 6,
            goalMode: "cut",
            aggr: 1,
            meals: 3,
            exp: "intermediate",
            carbSource: "rice",
            fatSource: "butter"
          });
          if (Math.abs(plan.fatChangeKg + 4.8) > 0.2) {
            throw new Error(`Expected fat change ≈ -4.8, got ${plan.fatChangeKg.toFixed(2)}`);
          }
          if (Math.abs(plan.targetCalories - 1688) > 5) {
            throw new Error(`Expected calories ≈ 1688, got ${plan.targetCalories.toFixed(0)}`);
          }
          if (Math.abs(plan.carbs - 135) > 7) {
            throw new Error(`Expected carbs ≈ 135g, got ${plan.carbs.toFixed(1)}`);
          }
        }
      },
      {
        name: "Bulk baseline (novice, 6 wks)",
        run: () => {
          const plan = computePlan({
            weight: 78,
            bodyfat: 15,
            tdee: 2568,
            weeks: 6,
            goalMode: "bulk",
            aggr: 1,
            meals: 4,
            exp: "novice",
            carbSource: "rice",
            fatSource: "oliveOil"
          });
          if (Math.abs(plan.muscleChangeKg - 1.5) > 0.05) {
            throw new Error(`Expected muscle change ≈ 1.5kg, got ${plan.muscleChangeKg.toFixed(2)}`);
          }
          if (Math.abs(plan.targetCalories - 2657) > 5) {
            throw new Error(`Expected calories ≈ 2657, got ${plan.targetCalories.toFixed(0)}`);
          }
        }
      },
      {
        name: "window.calculatePlan exposed",
        run: () => {
          if (typeof window.calculatePlan !== "function") {
            throw new Error("window.calculatePlan is not available");
          }
        }
      },
      {
        name: "Chart guard handles undefined",
        run: () => {
          window.progressChart = undefined;
          renderProjectionChart({ labels: ["Week 0"], weights: [80], bfs: [20], muscles: [0] });
        }
      },
      {
        name: "Chart guard handles non-chart objects",
        run: () => {
          window.progressChart = { foo: true };
          renderProjectionChart({ labels: ["Week 0"], weights: [80], bfs: [20], muscles: [0] });
        }
      },
      {
        name: "Double render remains stable",
        run: () => {
          const data = { labels: ["Week 0", "Week 1"], weights: [80, 79], bfs: [20, 19.5], muscles: [0, 0.2] };
          renderProjectionChart(data);
          renderProjectionChart(data);
        }
      },
      {
        name: "BF clamp floor at 3%",
        run: () => {
          const plan = computePlan({
            weight: 70,
            bodyfat: 2,
            tdee: 2200,
            weeks: 8,
            goalMode: "cut",
            aggr: 1,
            meals: 3,
            exp: "novice",
            carbSource: "rice",
            fatSource: "butter"
          });
          if (plan.bfs.some((bf) => bf < 3 - 0.01)) {
            throw new Error("Body fat dipped below 3% after clamping.");
          }
        }
      },
      {
        name: "Muscle series never decreases",
        run: () => {
          const plan = computePlan({
            weight: 80,
            bodyfat: 18,
            tdee: 2800,
            weeks: 12,
            goalMode: "bulk",
            aggr: 1,
            meals: 4,
            exp: "intermediate",
            carbSource: "rice",
            fatSource: "oliveOil"
          });
          for (let i = 1; i < plan.muscles.length; i += 1) {
            if (plan.muscles[i] < plan.muscles[i - 1] - 1e-6) {
              throw new Error("Muscle series decreased at week " + i);
            }
          }
        }
      },
      {
        name: "Series lengths match weeks + 1",
        run: () => {
          const plan = computePlan({
            weight: 75,
            bodyfat: 18,
            tdee: 2400,
            weeks: 10,
            goalMode: "cut",
            aggr: 1,
            meals: 3,
            exp: "intermediate",
            carbSource: "rice",
            fatSource: "butter"
          });
          const expected = 11;
          if (plan.labels.length !== expected || plan.weights.length !== expected || plan.bfs.length !== expected || plan.muscles.length !== expected) {
            throw new Error("Projection series length mismatch.");
          }
        }
      },
      {
        name: "Unrealistic cut triggers suggestions",
        run: () => {
          const plan = computePlan({
            weight: 95,
            bodyfat: 25,
            tdee: 3000,
            weeks: 6,
            goalMode: "cut",
            aggr: 1.5,
            meals: 4,
            exp: "intermediate",
            carbSource: "rice",
            fatSource: "butter"
          });
          if (!plan.suggestions) {
            throw new Error("Expected suggestions for unrealistic cut intensity.");
          }
        }
      },
      {
        name: "Apply suggestions updates fields & recalculates",
        run: () => {
          const form = document.getElementById("inputs-form");
          form.goal.value = "cut";
          form.intensity.value = "1.5";
          form.weight.value = 95;
          form.bodyfat.value = 25;
          form.tdee.value = 3000;
          form.weeks.value = 6;
          form.meals.value = 4;
          form.experience.value = "intermediate";
          form["carb-source"].value = "rice";
          form["fat-source"].value = "butter";
          handleCalculate();
          if (!latestSuggestions) {
            throw new Error("Suggestions did not populate before applying.");
          }
          applySuggestions();
          const intensity = Number(form.intensity.value);
          if (intensity >= 1.5 - 1e-6) {
            throw new Error("Intensity did not drop after applying suggestions.");
          }
          if (!lastPlan || !Array.isArray(lastPlan.weights)) {
            throw new Error("Plan did not recalculate after applying suggestions.");
          }
        }
      }
    ];

    tests.forEach((test) => {
      const li = document.createElement("li");
      li.textContent = test.name;
      try {
        test.run();
        li.classList.add("pass");
        li.textContent = `✅ ${test.name}`;
      } catch (err) {
        li.classList.add("fail");
        li.textContent = `❌ ${test.name}: ${err.message}`;
      }
      output.appendChild(li);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateMealsLabel(Number(document.getElementById("meals").value));
    updateAutoClass(document.getElementById("experience").value);
    document.getElementById("calculate-btn").addEventListener("click", () => handleCalculate());
    document.getElementById("tests-btn").addEventListener("click", () => runTests());
    document.getElementById("apply-btn").addEventListener("click", () => applySuggestions());
    document.getElementById("meals").addEventListener("input", (event) => updateMealsLabel(Number(event.target.value)));
    document.getElementById("experience").addEventListener("change", (event) => updateAutoClass(event.target.value));
    handleCalculate();
  });

  window.computePlan = computePlan;
  window.calculatePlan = computePlan;
  window.renderProjectionChart = renderProjectionChart;
  window.__planner = {
    handleCalculate,
    applySuggestions
  };
})();
